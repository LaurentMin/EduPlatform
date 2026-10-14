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
