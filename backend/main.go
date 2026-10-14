package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/golang-jwt/jwt/v5"
	"github.com/gorilla/websocket"
	_ "github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
)

// --- 1. CONFIGURATION ET MODÈLES ---

var jwtKey = []byte("super_secret_key_pour_le_dev")

const adminEmail = "prof@skeuly.com"

var availabilityLocation = func() *time.Location {
	location, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		return time.Local
	}
	return location
}()

func authorizeAdmin(r *http.Request) error {
	tokenString := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
		return jwtKey, nil
	})
	if err != nil || token == nil || !token.Valid {
		return fmt.Errorf("Non autorisé")
	}
	if strings.TrimSpace(strings.ToLower(claims.Email)) != adminEmail {
		return fmt.Errorf("Accès réservé au professeur")
	}
	return nil
}

type Credentials struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type Claims struct {
	UserID int    `json:"user_id"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

type Course struct {
	ID          int     `json:"id"`
	Title       string  `json:"title"`
	ScheduledAt string  `json:"date"`
	Duration    string  `json:"duration"`
	Status      string  `json:"status"`
	Price       float64 `json:"price"`
}

type Availability struct {
	ID            int       `json:"id"`
	Start         time.Time `json:"start"`
	End           time.Time `json:"end"`
	Recurring     bool      `json:"recurring"`
	Exceptional   bool      `json:"exceptional,omitempty"`
	RuleID        int       `json:"rule_id,omitempty"`
	RuleWeekday   int       `json:"rule_weekday,omitempty"`
	RuleStart     string    `json:"rule_start,omitempty"`
	RuleEnd       string    `json:"rule_end,omitempty"`
	ExceptionID   int       `json:"exception_id,omitempty"`
	ExceptionDate string    `json:"exception_date,omitempty"`
}

type AvailabilityRule struct {
	ID        int    `json:"id"`
	Weekday   int    `json:"weekday"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
}

var durationPattern = regexp.MustCompile(`(?i)^\s*(\d+)\s*h\s*(?:(\d+)\s*m)?\s*$`)

func durationMinutes(value string) (int, error) {
	matches := durationPattern.FindStringSubmatch(value)
	if matches == nil {
		return 0, fmt.Errorf("durée invalide")
	}
	hours, err := strconv.Atoi(matches[1])
	if err != nil || hours < 0 {
		return 0, fmt.Errorf("durée invalide")
	}
	minutes := 0
	if matches[2] != "" {
		minutes, err = strconv.Atoi(matches[2])
		if err != nil || minutes > 59 {
			return 0, fmt.Errorf("durée invalide")
		}
	}
	total := hours*60 + minutes
	if total <= 0 {
		return 0, fmt.Errorf("durée invalide")
	}
	return total, nil
}

func hasScheduleConflict(tx *sql.Tx, courseID int, start time.Time, duration int) (bool, error) {
	rows, err := tx.Query(`
		SELECT id, scheduled_at, duration
		FROM courses
		WHERE id <> $1
		  AND status NOT IN ('réalisé', 'realise')
		FOR UPDATE`, courseID)
	if err != nil {
		return false, err
	}

	defer rows.Close()

	end := start.Add(time.Duration(duration) * time.Minute)
	for rows.Next() {
		var existingID int
		var existingStart time.Time
		var existingDuration string
		if err := rows.Scan(&existingID, &existingStart, &existingDuration); err != nil {
			return false, err
		}
		existingMinutes, err := durationMinutes(existingDuration)
		if err != nil {
			return false, fmt.Errorf("durée du cours %d invalide: %w", existingID, err)
		}
		existingEnd := existingStart.Add(time.Duration(existingMinutes) * time.Minute)
		if start.Before(existingEnd) && existingStart.Before(end) {
			return true, nil
		}
	}
	return false, rows.Err()
}

func hasAvailability(tx *sql.Tx, start time.Time, duration int) (bool, error) {
	start = start.In(availabilityLocation)
	end := start.Add(time.Duration(duration) * time.Minute)
	type interval struct {
		start time.Time
		end   time.Time
	}
	intervals := []interval{}
	exceptions := make(map[string]struct {
		start time.Time
		end   time.Time
	})
	exceptionRows, err := tx.Query(`
		SELECT exception_date, start_time::text, end_time::text
		FROM availability_exceptions`)
	if err != nil {
		return false, err
	}
	for exceptionRows.Next() {
		var date time.Time
		var startClock, endClock string
		if err := exceptionRows.Scan(&date, &startClock, &endClock); err != nil {
			exceptionRows.Close()
			return false, err
		}
		clockStart, err := time.Parse("15:04:05", startClock)
		if err != nil {
			exceptionRows.Close()
			return false, err
		}
		clockEnd, err := time.Parse("15:04:05", endClock)
		if err != nil {
			exceptionRows.Close()
			return false, err
		}
		dayStart := time.Date(date.Year(), date.Month(), date.Day(), clockStart.Hour(), clockStart.Minute(), 0, 0, availabilityLocation)
		dayEnd := time.Date(date.Year(), date.Month(), date.Day(), clockEnd.Hour(), clockEnd.Minute(), 0, 0, availabilityLocation)
		exceptions[date.Format("2006-01-02")] = struct {
			start time.Time
			end   time.Time
		}{start: dayStart, end: dayEnd}
		intervals = append(intervals, interval{dayStart, dayEnd})
	}
	if err := exceptionRows.Err(); err != nil {
		exceptionRows.Close()
		return false, err
	}
	exceptionRows.Close()
	ruleRows, err := tx.Query(`
		SELECT weekday, start_time::text, end_time::text
		FROM availability_rules`)
	if err != nil {
		return false, err
	}
	defer ruleRows.Close()
	for ruleRows.Next() {
		var weekday int
		var startClock, endClock string
		if err := ruleRows.Scan(&weekday, &startClock, &endClock); err != nil {
			return false, err
		}
		clockStart, err := time.Parse("15:04:05", startClock)
		if err != nil {
			return false, err
		}
		clockEnd, err := time.Parse("15:04:05", endClock)
		if err != nil {
			return false, err
		}
		for day := start.AddDate(0, 0, -1); day.Before(end); day = day.AddDate(0, 0, 1) {
			if int(day.Weekday()) == weekday {
				if _, overridden := exceptions[day.Format("2006-01-02")]; overridden {
					continue
				}
				dayStart := time.Date(day.Year(), day.Month(), day.Day(), clockStart.Hour(), clockStart.Minute(), 0, 0, availabilityLocation)
				dayEnd := time.Date(day.Year(), day.Month(), day.Day(), clockEnd.Hour(), clockEnd.Minute(), 0, 0, availabilityLocation)
				intervals = append(intervals, interval{dayStart, dayEnd})
			}
		}
	}
	if err := ruleRows.Err(); err != nil {
		return false, err
	}
	sort.Slice(intervals, func(i, j int) bool {
		return intervals[i].start.Before(intervals[j].start)
	})
	coveredUntil := start
	for _, available := range intervals {
		if available.start.After(coveredUntil) {
			continue
		}
		if available.end.After(coveredUntil) {
			coveredUntil = available.end
		}
		if !coveredUntil.Before(end) {
			return true, nil
		}
	}
	return false, nil
}

type Message struct {
	Sender    string `json:"sender"`
	Recipient string `json:"recipient"` // NOUVEAU: Le destinataire
	Content   string `json:"content"`
	Type      string `json:"type"`
	Timestamp string `json:"timestamp"`
}

// NOUVEAU: Un payload qui transporte le JSON brut et la structure
type MessagePayload struct {
	Raw []byte
	Msg Message
}

type Client struct {
	hub   *Hub
	conn  *websocket.Conn
	send  chan []byte
	email string // NOUVEAU: On stocke l'email pour l'identifier
	db    *sql.DB
}

type Hub struct {
	clients    map[*Client]bool
	broadcast  chan MessagePayload // NOUVEAU: On utilise le payload
	register   chan *Client
	unregister chan *Client
}

func newHub() *Hub {
	return &Hub{
		broadcast:  make(chan MessagePayload),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		clients:    make(map[*Client]bool),
	}
}

// --- 2. LOGIQUE WEBSOCKET (HUB) ---

func (h *Hub) run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client] = true
			log.Printf("🔌 Client connecté: %s. Total: %d", client.email, len(h.clients))
		case client := <-h.unregister:
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
				log.Printf("🔌 Client déconnecté: %s. Total: %d", client.email, len(h.clients))
			}
		case payload := <-h.broadcast:
			// ROUTAGE PRIVÉ: On ne l'envoie qu'à l'expéditeur (pour ses autres onglets) et au destinataire
			for client := range h.clients {
				if client.email == payload.Msg.Recipient || client.email == payload.Msg.Sender {
					select {
					case client.send <- payload.Raw:
					default:
						close(client.send)
						delete(h.clients, client)
					}
				}
			}
		}
	}
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	for {
		_, p, err := c.conn.ReadMessage()
		if err != nil {
			break
		}
		var msg Message
		if err := json.Unmarshal(p, &msg); err == nil {
			msg.Sender = c.email
			msg.Content = strings.TrimSpace(msg.Content)
			if msg.Content == "" || msg.Recipient == "" {
				continue
			}

			createdAt := time.Now().UTC()
			msg.Timestamp = createdAt.Format(time.RFC3339)
			_, err := c.db.Exec(
				`INSERT INTO messages (sender, recipient, content, type, created_at)
				 VALUES ($1, $2, $3, $4, $5)`,
				msg.Sender, msg.Recipient, msg.Content, msg.Type, createdAt,
			)
			if err != nil {
				log.Printf("❌ Erreur lors de l'enregistrement du message: %v", err)
				continue
			}

			out, err := json.Marshal(msg)
			if err != nil {
				log.Printf("❌ Erreur de sérialisation du message: %v", err)
				continue
			}
			c.hub.broadcast <- MessagePayload{Raw: out, Msg: msg}
		}
	}
}

func (c *Client) writePump() {
	defer c.conn.Close()
	for {
		message, ok := <-c.send
		if !ok {
			c.conn.WriteMessage(websocket.CloseMessage, []byte{})
			return
		}
		c.conn.WriteMessage(websocket.TextMessage, message)
	}
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

// --- 3. SERVEUR HTTP ET ROUTES ---

// Middleware CORS
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "http://localhost:3000")
		w.Header().Set("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Accept, Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func main() {
	dbURL := os.Getenv("DB_URL")
	if dbURL == "" {
		dbURL = "postgres://devuser:devpassword@localhost:5433/calendar_db?sslmode=disable"
	}
	s3Endpoint := os.Getenv("S3_ENDPOINT")
	if s3Endpoint == "" {
		s3Endpoint = "http://localhost:3900"
	}

	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Erreur DB: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("Impossible de contacter PostgreSQL: %v", err)
	}
	log.Println("✅ Connecté à PostgreSQL")

	// Création de la table users
	createTableQuery := `
	CREATE TABLE IF NOT EXISTS users (
		id SERIAL PRIMARY KEY,
		email VARCHAR(255) UNIQUE NOT NULL,
		password_hash VARCHAR(255) NOT NULL,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);`
	if _, err := db.Exec(createTableQuery); err != nil {
		log.Fatalf("❌ Erreur lors de la création de la table users: %v", err)
	}
	log.Println("✅ Table users prête")

	// Création de la table courses
	createCoursesTableQuery := `
	CREATE TABLE IF NOT EXISTS courses (
		id SERIAL PRIMARY KEY,
		client_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
		title VARCHAR(255) NOT NULL,
		scheduled_at TIMESTAMP NOT NULL,
		duration VARCHAR(50) NOT NULL,
		status VARCHAR(50) DEFAULT 'demandé',
		price NUMERIC(10, 2) DEFAULT 25.00,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);`
	if _, err := db.Exec(createCoursesTableQuery); err != nil {
		log.Fatalf("❌ Erreur lors de la création de la table courses: %v", err)
	}
	log.Println("✅ Table courses prête")

	createMessagesTableQuery := `
	CREATE TABLE IF NOT EXISTS messages (
		id BIGSERIAL PRIMARY KEY,
		sender VARCHAR(255) NOT NULL,
		recipient VARCHAR(255) NOT NULL,
		content TEXT NOT NULL,
		type VARCHAR(50) NOT NULL DEFAULT 'text',
		created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
	);`
	if _, err := db.Exec(createMessagesTableQuery); err != nil {
		log.Fatalf("❌ Erreur lors de la création de la table messages: %v", err)
	}
	log.Println("✅ Table messages prête")

	if _, err := db.Exec(`DROP TABLE IF EXISTS availabilities`); err != nil {
		log.Fatalf("❌ Erreur lors de la suppression de la table availabilities: %v", err)
	}
	log.Println("✅ Table availabilities supprimée")

	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS availability_rules (
			id SERIAL PRIMARY KEY,
			weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
			start_time TIME NOT NULL,
			end_time TIME NOT NULL,
			CONSTRAINT availability_rule_range_valid CHECK (end_time > start_time)
		);`); err != nil {
		log.Fatalf("❌ Erreur lors de la création des règles de disponibilité: %v", err)
	}
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS availability_exceptions (
			id SERIAL PRIMARY KEY,
			exception_date DATE NOT NULL UNIQUE,
			start_time TIME NOT NULL,
			end_time TIME NOT NULL,
			CONSTRAINT availability_exception_range_valid CHECK (end_time > start_time)
		);`); err != nil {
		log.Fatalf("❌ Erreur lors de la création des exceptions de disponibilité: %v", err)
	}

	// S3 Garage
	customResolver := aws.EndpointResolverWithOptionsFunc(func(service, region string, options ...interface{}) (aws.Endpoint, error) {
		return aws.Endpoint{PartitionID: "aws", URL: s3Endpoint, SigningRegion: "garage"}, nil
	})
	cfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithEndpointResolverWithOptions(customResolver),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider("CLE_ACCES_DEV", "CLE_SECRETE_DEV", "")),
	)
	if err != nil {
		log.Fatalf("Erreur AWS: %v", err)
	}
	s3Client := s3.NewFromConfig(cfg, func(o *s3.Options) { o.UsePathStyle = true })
	_ = s3Client
	log.Println("✅ Client S3 (Garage) initialisé")

	// Hub
	hub := newHub()
	go hub.run()

	mux := http.NewServeMux()

	// Inscription
	mux.HandleFunc("POST /api/register", func(w http.ResponseWriter, r *http.Request) {
		var creds Credentials
		if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
			http.Error(w, "Requête invalide", http.StatusBadRequest)
			return
		}
		hashedPassword, _ := bcrypt.GenerateFromPassword([]byte(creds.Password), 14)
		_, err = db.Exec("INSERT INTO users (email, password_hash) VALUES ($1, $2)", creds.Email, string(hashedPassword))
		if err != nil {
			http.Error(w, "Cet email est déjà utilisé", http.StatusConflict)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"message": "Utilisateur créé"})
	})

	// Connexion
	mux.HandleFunc("POST /api/login", func(w http.ResponseWriter, r *http.Request) {
		var creds Credentials
		if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
			http.Error(w, "Requête invalide", http.StatusBadRequest)
			return
		}
		var id int
		var storedHash string
		err := db.QueryRow("SELECT id, password_hash FROM users WHERE email = $1", creds.Email).Scan(&id, &storedHash)
		if err != nil || bcrypt.CompareHashAndPassword([]byte(storedHash), []byte(creds.Password)) != nil {
			http.Error(w, "Identifiants incorrects", http.StatusUnauthorized)
			return
		}
		expirationTime := time.Now().Add(24 * time.Hour)
		claims := &Claims{
			UserID:           id,
			Email:            creds.Email,
			RegisteredClaims: jwt.RegisteredClaims{ExpiresAt: jwt.NewNumericDate(expirationTime)},
		}
		token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
		tokenString, _ := token.SignedString(jwtKey)
		json.NewEncoder(w).Encode(map[string]string{"token": tokenString})
	})

	// Créer une réservation (Protéger par JWT)
	mux.HandleFunc("POST /api/courses", func(w http.ResponseWriter, r *http.Request) {
		// 1. Extraire et vérifier le token
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "Non autorisé", http.StatusUnauthorized)
			return
		}
		tokenString := strings.TrimPrefix(authHeader, "Bearer ")

		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
			return jwtKey, nil
		})
		if err != nil || !token.Valid {
			http.Error(w, "Token invalide", http.StatusUnauthorized)
			return
		}

		// 2. Décoder la demande
		var req struct {
			Title    string `json:"title"`
			Date     string `json:"date"`
			Duration string `json:"duration"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Requête invalide", http.StatusBadRequest)
			return
		}
		scheduledAt, err := time.Parse(time.RFC3339, req.Date)
		if err != nil || !scheduledAt.After(time.Now()) {
			http.Error(w, "La date doit être valide et dans le futur", http.StatusBadRequest)
			return
		}
		duration, err := durationMinutes(req.Duration)
		if err != nil {
			http.Error(w, "La durée du cours est invalide", http.StatusBadRequest)
			return
		}

		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		available, err := hasAvailability(tx, scheduledAt, duration)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		if !available {
			tx.Rollback()
			http.Error(w, "Ce créneau n'est pas disponible", http.StatusConflict)
			return
		}
		conflict, err := hasScheduleConflict(tx, 0, scheduledAt, duration)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		if conflict {
			tx.Rollback()
			http.Error(w, "Ce créneau est déjà occupé", http.StatusConflict)
			return
		}

		_, err = tx.Exec(
			`INSERT INTO courses (client_id, title, scheduled_at, duration)
			 VALUES ($1, $2, $3, $4)`,
			claims.UserID, req.Title, scheduledAt, req.Duration,
		)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}

		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"message": "Cours réservé avec succès"})
	})

	// Récupérer les disponibilités d'une période
	mux.HandleFunc("GET /api/availability", func(w http.ResponseWriter, r *http.Request) {
		tokenString := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
			return jwtKey, nil
		})
		if token == nil || err != nil || !token.Valid {
			http.Error(w, "Non autorisé", http.StatusUnauthorized)
			return
		}
		start, err := time.Parse(time.RFC3339, r.URL.Query().Get("start"))
		if err != nil {
			http.Error(w, "Période invalide", http.StatusBadRequest)
			return
		}
		end, err := time.Parse(time.RFC3339, r.URL.Query().Get("end"))
		if err != nil || !end.After(start) {
			http.Error(w, "Période invalide", http.StatusBadRequest)
			return
		}
		start = start.In(availabilityLocation)
		end = end.In(availabilityLocation)
		availabilities := []Availability{}
		exceptions := make(map[string]struct {
			id    int
			start string
			end   string
		})
		exceptionRows, err := db.Query(`
			SELECT id, exception_date::text, start_time::text, end_time::text
			FROM availability_exceptions
			WHERE exception_date >= $1::date AND exception_date < $2::date`,
			start.Format("2006-01-02"), end.Format("2006-01-02"),
		)
		if err != nil {
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		for exceptionRows.Next() {
			var id int
			var date, startTime, endTime string
			if err := exceptionRows.Scan(&id, &date, &startTime, &endTime); err != nil {
				exceptionRows.Close()
				http.Error(w, "Erreur base de données", http.StatusInternalServerError)
				return
			}
			exceptions[date] = struct {
				id    int
				start string
				end   string
			}{id: id, start: startTime, end: endTime}
		}
		if err := exceptionRows.Err(); err != nil {
			exceptionRows.Close()
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		exceptionRows.Close()

		for date, exception := range exceptions {
			day, err := time.ParseInLocation("2006-01-02", date, start.Location())
			if err != nil {
				http.Error(w, "Date d'exception invalide", http.StatusInternalServerError)
				return
			}
			exceptionStart, err := time.Parse("15:04:05", exception.start)
			if err != nil {
				http.Error(w, "Format d'horaire d'exception invalide", http.StatusInternalServerError)
				return
			}
			exceptionEnd, err := time.Parse("15:04:05", exception.end)
			if err != nil {
				http.Error(w, "Format d'horaire d'exception invalide", http.StatusInternalServerError)
				return
			}
			dayStart := time.Date(day.Year(), day.Month(), day.Day(), exceptionStart.Hour(), exceptionStart.Minute(), 0, 0, day.Location())
			dayEnd := time.Date(day.Year(), day.Month(), day.Day(), exceptionEnd.Hour(), exceptionEnd.Minute(), 0, 0, day.Location())
			for slot := dayStart; slot.Before(dayEnd); slot = slot.Add(15 * time.Minute) {
				availabilities = append(availabilities, Availability{
					ID: -exception.id, Exceptional: true, ExceptionID: exception.id,
					RuleWeekday:   int(day.Weekday()),
					ExceptionDate: date, RuleStart: exception.start, RuleEnd: exception.end,
					Start: slot, End: slot.Add(15 * time.Minute),
				})
			}
		}
		ruleRows, err := db.Query(`
			SELECT id, weekday, start_time::text, end_time::text
			FROM availability_rules`)
		if err != nil {
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		for ruleRows.Next() {
			var rule AvailabilityRule
			if err := ruleRows.Scan(&rule.ID, &rule.Weekday, &rule.StartTime, &rule.EndTime); err != nil {
				ruleRows.Close()
				http.Error(w, "Erreur base de données", http.StatusInternalServerError)
				return
			}
			for day := start; day.Before(end); day = day.AddDate(0, 0, 1) {
				if int(day.Weekday()) != rule.Weekday {
					continue
				}
				if _, overridden := exceptions[day.Format("2006-01-02")]; overridden {
					continue
				}
				ruleStart, err := time.Parse("15:04:05", rule.StartTime)
				if err != nil {
					ruleRows.Close()
					http.Error(w, "Format d'horaire de disponibilité invalide", http.StatusInternalServerError)
					return
				}
				ruleEnd, err := time.Parse("15:04:05", rule.EndTime)
				if err != nil {
					ruleRows.Close()
					http.Error(w, "Format d'horaire de disponibilité invalide", http.StatusInternalServerError)
					return
				}
				dayStart := time.Date(day.Year(), day.Month(), day.Day(), ruleStart.Hour(), ruleStart.Minute(), 0, 0, day.Location())
				dayEnd := time.Date(day.Year(), day.Month(), day.Day(), ruleEnd.Hour(), ruleEnd.Minute(), 0, 0, day.Location())
				for slot := dayStart; slot.Before(dayEnd); slot = slot.Add(15 * time.Minute) {
					availabilities = append(availabilities, Availability{
						ID: -rule.ID, Recurring: true, RuleID: rule.ID,
						RuleWeekday: rule.Weekday,
						RuleStart:   rule.StartTime, RuleEnd: rule.EndTime,
						Start: slot,
						End:   slot.Add(15 * time.Minute),
					})
				}
			}
		}
		if err := ruleRows.Err(); err != nil {
			ruleRows.Close()
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		ruleRows.Close()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(availabilities)
	})

	// Définir une règle de disponibilité hebdomadaire (réservé au professeur)
	mux.HandleFunc("POST /api/availability", func(w http.ResponseWriter, r *http.Request) {
		tokenString := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
			return jwtKey, nil
		})
		if token == nil || err != nil || !token.Valid {
			http.Error(w, "Non autorisé", http.StatusUnauthorized)
			return
		}
		if claims.Email != adminEmail {
			http.Error(w, "Accès réservé au professeur", http.StatusForbidden)
			return
		}
		var req struct {
			Date  string `json:"date"`
			Start string `json:"start"`
			End   string `json:"end"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Requête invalide", http.StatusBadRequest)
			return
		}
		startDate, err := time.ParseInLocation("2006-01-02", req.Date, availabilityLocation)
		if err != nil {
			http.Error(w, "Date invalide", http.StatusBadRequest)
			return
		}
		startClock, err := time.Parse("15:04", req.Start)
		endClock, endErr := time.Parse("15:04", req.End)
		if err != nil || endErr != nil {
			http.Error(w, "Horaire invalide", http.StatusBadRequest)
			return
		}
		start := time.Date(startDate.Year(), startDate.Month(), startDate.Day(), startClock.Hour(), startClock.Minute(), 0, 0, availabilityLocation)
		end := time.Date(startDate.Year(), startDate.Month(), startDate.Day(), endClock.Hour(), endClock.Minute(), 0, 0, availabilityLocation)
		if !start.After(time.Now()) || !end.After(start) ||
			start.Second() != 0 || start.Nanosecond() != 0 ||
			end.Second() != 0 || end.Nanosecond() != 0 ||
			start.Minute()%15 != 0 || end.Minute()%15 != 0 {
			http.Error(w, "Les horaires doivent être espacés de 15 minutes et être dans le futur", http.StatusBadRequest)
			return
		}
		_, err = db.Exec(
			`INSERT INTO availability_rules (weekday, start_time, end_time)
			 VALUES ($1, $2, $3)`,
			int(start.Weekday()), start.Format("15:04:05"), end.Format("15:04:05"),
		)
		if err != nil {
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"message": "Règle de disponibilité ajoutée"})
	})

	mux.HandleFunc("POST /api/availability-exceptions", func(w http.ResponseWriter, r *http.Request) {
		if err := authorizeAdmin(r); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		var req struct {
			Date  string `json:"date"`
			Start string `json:"start"`
			End   string `json:"end"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Requête invalide", http.StatusBadRequest)
			return
		}
		date, dateErr := time.Parse("2006-01-02", req.Date)
		start, startErr := time.Parse("15:04", req.Start)
		end, endErr := time.Parse("15:04", req.End)
		if dateErr != nil || startErr != nil || endErr != nil || !end.After(start) ||
			start.Minute()%15 != 0 || end.Minute()%15 != 0 || !date.After(time.Now().AddDate(0, 0, -1)) {
			http.Error(w, "Date ou horaires invalides", http.StatusBadRequest)
			return
		}
		_, err := db.Exec(`
			INSERT INTO availability_exceptions (exception_date, start_time, end_time)
			VALUES ($1, $2, $3)
			ON CONFLICT (exception_date) DO UPDATE SET start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time`,
			req.Date, req.Start, req.End,
		)
		if err != nil {
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusCreated)
		json.NewEncoder(w).Encode(map[string]string{"message": "Disponibilité exceptionnelle ajoutée"})
	})

	mux.HandleFunc("PUT /api/availability-exceptions/{id}", func(w http.ResponseWriter, r *http.Request) {
		if err := authorizeAdmin(r); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil || id < 1 {
			http.Error(w, "Identifiant invalide", http.StatusBadRequest)
			return
		}
		var req struct {
			Date  string `json:"date"`
			Start string `json:"start"`
			End   string `json:"end"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Requête invalide", http.StatusBadRequest)
			return
		}
		date, dateErr := time.Parse("2006-01-02", req.Date)
		start, startErr := time.Parse("15:04", req.Start)
		end, endErr := time.Parse("15:04", req.End)
		if dateErr != nil || startErr != nil || endErr != nil || !end.After(start) ||
			start.Minute()%15 != 0 || end.Minute()%15 != 0 || !date.After(time.Now().AddDate(0, 0, -1)) {
			http.Error(w, "Date ou horaires invalides", http.StatusBadRequest)
			return
		}
		result, err := db.Exec(`
			UPDATE availability_exceptions
			SET exception_date = $1, start_time = $2, end_time = $3
			WHERE id = $4`, req.Date, req.Start, req.End, id)
		if err != nil {
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			http.Error(w, "Exception introuvable", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("DELETE /api/availability-exceptions/{id}", func(w http.ResponseWriter, r *http.Request) {
		if err := authorizeAdmin(r); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil || id < 1 {
			http.Error(w, "Identifiant invalide", http.StatusBadRequest)
			return
		}
		result, err := db.Exec("DELETE FROM availability_exceptions WHERE id = $1", id)
		if err != nil {
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			http.Error(w, "Exception introuvable", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("PUT /api/availability-rules/{id}", func(w http.ResponseWriter, r *http.Request) {
		if err := authorizeAdmin(r); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil || id < 1 {
			http.Error(w, "Identifiant invalide", http.StatusBadRequest)
			return
		}
		var req struct{ Start, End string }
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Requête invalide", http.StatusBadRequest)
			return
		}
		start, startErr := time.Parse("15:04", req.Start)
		end, endErr := time.Parse("15:04", req.End)
		if startErr != nil || endErr != nil || !end.After(start) || start.Minute()%15 != 0 || end.Minute()%15 != 0 {
			http.Error(w, "Horaires invalides", http.StatusBadRequest)
			return
		}
		result, err := db.Exec("UPDATE availability_rules SET start_time = $1, end_time = $2 WHERE id = $3", req.Start, req.End, id)
		if err != nil {
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			http.Error(w, "Règle introuvable", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	mux.HandleFunc("DELETE /api/availability-rules/{id}", func(w http.ResponseWriter, r *http.Request) {
		if err := authorizeAdmin(r); err != nil {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}
		id, err := strconv.Atoi(r.PathValue("id"))
		if err != nil || id < 1 {
			http.Error(w, "Identifiant invalide", http.StatusBadRequest)
			return
		}
		result, err := db.Exec("DELETE FROM availability_rules WHERE id = $1", id)
		if err != nil {
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		affected, _ := result.RowsAffected()
		if affected == 0 {
			http.Error(w, "Règle introuvable", http.StatusNotFound)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})

	// Récupérer la liste des cours (Protéger par JWT)
	mux.HandleFunc("GET /api/courses", func(w http.ResponseWriter, r *http.Request) {
		tokenString := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims := &Claims{}
		token, _ := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) { return jwtKey, nil })
		if token == nil || !token.Valid {
			http.Error(w, "Non autorisé", http.StatusUnauthorized)
			return
		}
		query := "SELECT id, title, scheduled_at, duration, status, price FROM courses WHERE client_id = $1 ORDER BY scheduled_at DESC"
		queryArgs := []interface{}{claims.UserID}
		if claims.Email == adminEmail {
			query = "SELECT id, title, scheduled_at, duration, status, price FROM courses ORDER BY scheduled_at DESC"
			queryArgs = nil
		}

		rows, err := db.Query(query, queryArgs...)
		if err != nil {
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		defer rows.Close()
		var courses []Course
		for rows.Next() {
			var c Course
			var scheduledAt time.Time
			if err := rows.Scan(&c.ID, &c.Title, &scheduledAt, &c.Duration, &c.Status, &c.Price); err != nil {
				http.Error(w, "Erreur base de données", http.StatusInternalServerError)
				return
			}
			c.ScheduledAt = scheduledAt.Format(time.RFC3339)
			courses = append(courses, c)
		}
		if err := rows.Err(); err != nil {
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		if courses == nil {
			courses = []Course{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(courses)
	})

	// Accepter une demande de cours (réservé au professeur)
	mux.HandleFunc("PUT /api/courses/{id}/accept", func(w http.ResponseWriter, r *http.Request) {
		tokenString := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
			return jwtKey, nil
		})
		if token == nil || err != nil || !token.Valid {
			http.Error(w, "Non autorisé", http.StatusUnauthorized)
			return
		}
		if claims.Email != adminEmail {
			http.Error(w, "Accès réservé au professeur", http.StatusForbidden)
			return
		}

		courseID, err := strconv.Atoi(r.PathValue("id"))
		if err != nil || courseID < 1 {
			http.Error(w, "Identifiant de cours invalide", http.StatusBadRequest)
			return
		}
		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		var scheduledAt time.Time
		var courseDuration string
		err = tx.QueryRow(
			"SELECT scheduled_at, duration FROM courses WHERE id = $1 AND status = 'demandé' FOR UPDATE",
			courseID,
		).Scan(&scheduledAt, &courseDuration)
		if err == sql.ErrNoRows {
			tx.Rollback()
			http.Error(w, "Demande introuvable ou déjà traitée", http.StatusConflict)
			return
		}
		if err != nil {
			tx.Rollback()
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		duration, err := durationMinutes(courseDuration)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Durée du cours invalide", http.StatusInternalServerError)
			return
		}
		available, err := hasAvailability(tx, scheduledAt, duration)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		if !available {
			tx.Rollback()
			http.Error(w, "Impossible d'accepter: ce créneau n'est pas disponible", http.StatusConflict)
			return
		}
		conflict, err := hasScheduleConflict(tx, courseID, scheduledAt, duration)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		if conflict {
			tx.Rollback()
			http.Error(w, "Impossible d'accepter: ce créneau est déjà occupé", http.StatusConflict)
			return
		}
		result, err := tx.Exec(
			"UPDATE courses SET status = 'confirmé' WHERE id = $1 AND status = 'demandé'",
			courseID,
		)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}

		rowsAffected, err := result.RowsAffected()
		if err != nil {
			tx.Rollback()
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		if rowsAffected == 0 {
			tx.Rollback()
			http.Error(w, "Demande introuvable ou déjà traitée", http.StatusConflict)
			return
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"message": "Cours accepté"})
	})

	// Reprogrammer un cours à venir (réservé au professeur)
	mux.HandleFunc("PUT /api/courses/{id}/reschedule", func(w http.ResponseWriter, r *http.Request) {
		tokenString := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
			return jwtKey, nil
		})
		if token == nil || err != nil || !token.Valid {
			http.Error(w, "Non autorisé", http.StatusUnauthorized)
			return
		}
		if claims.Email != adminEmail {
			http.Error(w, "Accès réservé au professeur", http.StatusForbidden)
			return
		}

		courseID, err := strconv.Atoi(r.PathValue("id"))
		if err != nil || courseID < 1 {
			http.Error(w, "Identifiant de cours invalide", http.StatusBadRequest)
			return
		}

		var req struct {
			Date string `json:"date"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Requête invalide", http.StatusBadRequest)
			return
		}
		scheduledAt, err := time.Parse(time.RFC3339, req.Date)
		if err != nil || !scheduledAt.After(time.Now()) {
			http.Error(w, "La nouvelle date doit être valide et dans le futur", http.StatusBadRequest)
			return
		}

		tx, err := db.Begin()
		if err != nil {
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		var currentDuration string
		err = tx.QueryRow(
			"SELECT duration FROM courses WHERE id = $1 AND status NOT IN ('réalisé', 'realise') FOR UPDATE",
			courseID,
		).Scan(&currentDuration)
		if err == sql.ErrNoRows {
			tx.Rollback()
			http.Error(w, "Cours introuvable ou déjà réalisé", http.StatusConflict)
			return
		}
		if err != nil {
			tx.Rollback()
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		duration, err := durationMinutes(currentDuration)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Durée du cours invalide", http.StatusInternalServerError)
			return
		}
		available, err := hasAvailability(tx, scheduledAt, duration)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		if !available {
			tx.Rollback()
			http.Error(w, "Impossible de reprogrammer: ce créneau n'est pas disponible", http.StatusConflict)
			return
		}
		conflict, err := hasScheduleConflict(tx, courseID, scheduledAt, duration)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		if conflict {
			tx.Rollback()
			http.Error(w, "Impossible de reprogrammer: ce créneau est déjà occupé", http.StatusConflict)
			return
		}
		result, err := tx.Exec(
			`UPDATE courses
			 SET scheduled_at = $1
			 WHERE id = $2
			   AND status NOT IN ('réalisé', 'realise')`,
			scheduledAt, courseID,
		)
		if err != nil {
			tx.Rollback()
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		rowsAffected, err := result.RowsAffected()
		if err != nil {
			tx.Rollback()
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}
		if rowsAffected == 0 {
			tx.Rollback()
			http.Error(w, "Cours introuvable, déjà passé ou déjà réalisé", http.StatusConflict)
			return
		}
		if err := tx.Commit(); err != nil {
			http.Error(w, "Erreur base de données", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"message": "Cours reprogrammé"})
	})

	// WebSocket
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		tokenString := r.URL.Query().Get("token")
		claims := &Claims{}
		token, err := jwt.ParseWithClaims(tokenString, claims, func(token *jwt.Token) (interface{}, error) {
			return jwtKey, nil
		})
		if tokenString == "" || err != nil || !token.Valid {
			http.Error(w, "Token invalide", http.StatusUnauthorized)
			return
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}

		client := &Client{hub: hub, conn: conn, send: make(chan []byte, 256), email: claims.Email, db: db}
		var history [][]byte

		historyQuery := `
			SELECT sender, recipient, content, type, created_at
			FROM messages
			WHERE (sender = $1 AND recipient = $2)
			   OR (sender = $2 AND recipient = $1)
			ORDER BY created_at ASC, id ASC`
		historyArgs := []interface{}{claims.Email, adminEmail}
		if claims.Email == adminEmail {
			historyQuery = `
				SELECT sender, recipient, content, type, created_at
				FROM messages
				ORDER BY created_at ASC, id ASC`
			historyArgs = nil
		}

		rows, err := db.Query(historyQuery, historyArgs...)
		if err != nil {
			conn.Close()
			log.Printf("❌ Erreur lors du chargement de l'historique: %v", err)
			return
		}
		for rows.Next() {
			var msg Message
			var createdAt time.Time
			if err := rows.Scan(&msg.Sender, &msg.Recipient, &msg.Content, &msg.Type, &createdAt); err != nil {
				rows.Close()
				conn.Close()
				log.Printf("❌ Erreur lors de la lecture de l'historique: %v", err)
				return
			}
			msg.Timestamp = createdAt.Format(time.RFC3339)
			raw, err := json.Marshal(msg)
			if err != nil {
				continue
			}
			history = append(history, raw)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			conn.Close()
			log.Printf("❌ Erreur lors du chargement de l'historique: %v", err)
			return
		}

		go client.writePump()
		for _, raw := range history {
			client.send <- raw
		}
		client.hub.register <- client
		go client.readPump()
	})

	log.Println("🚀 Serveur à l'écoute sur le port :8080")
	http.ListenAndServe(":8080", corsMiddleware(mux))
}
