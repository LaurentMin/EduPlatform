package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/gorilla/websocket"
	_ "github.com/lib/pq"
)

// Configuration globale du WebSocket (placée à l'extérieur du main)
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	// Autoriser toutes les origines en développement (Next.js sur le port 3000)
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func main() {
	log.Println("Démarrage du serveur...")

	// 1. Récupération des variables d'environnement
	dbURL := os.Getenv("DB_URL")
	if dbURL == "" {
		dbURL = "postgres://devuser:devpassword@localhost:5433/calendar_db?sslmode=disable"
	}

	s3Endpoint := os.Getenv("S3_ENDPOINT")
	if s3Endpoint == "" {
		s3Endpoint = "http://localhost:3900"
	}

	// 2. Connexion à PostgreSQL
	db, err := sql.Open("postgres", dbURL)
	if err != nil {
		log.Fatalf("Erreur d'initialisation de la base de données: %v", err)
	}
	defer db.Close()

	if err := db.Ping(); err != nil {
		log.Fatalf("Impossible de contacter PostgreSQL: %v", err)
	}
	log.Println("✅ Connecté à PostgreSQL")

	// 3. Connexion à Garage (S3)
	customResolver := aws.EndpointResolverWithOptionsFunc(func(service, region string, options ...interface{}) (aws.Endpoint, error) {
		return aws.Endpoint{
			PartitionID:   "aws",
			URL:           s3Endpoint,
			SigningRegion: "garage",
		}, nil
	})

	cfg, err := config.LoadDefaultConfig(context.TODO(),
		config.WithEndpointResolverWithOptions(customResolver),
		config.WithCredentialsProvider(credentials.NewStaticCredentialsProvider("CLE_ACCES_DEV", "CLE_SECRETE_DEV", "")),
	)
	if err != nil {
		log.Fatalf("Erreur de configuration AWS: %v", err)
	}

	s3Client := s3.NewFromConfig(cfg, func(o *s3.Options) {
		o.UsePathStyle = true
	})
	_ = s3Client

	log.Println("✅ Client S3 (Garage) initialisé")

	// 4. Configuration du Routeur HTTP
	mux := http.NewServeMux()

	// Route de santé
	mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status": "ok",
			"time":   time.Now().Format(time.RFC3339),
		})
	})

	// Route WebSocket (Chat) - DÉPLACÉE ICI, AVANT ListenAndServe
	mux.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		// 1. Upgrade de la connexion HTTP vers WebSocket
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Println("❌ Erreur d'upgrade WebSocket:", err)
			return
		}
		defer conn.Close()

		log.Println("🔌 Nouveau client WebSocket connecté !")

		// 2. Boucle d'écoute
		for {
			messageType, p, err := conn.ReadMessage()
			if err != nil {
				log.Println("🔌 Client déconnecté")
				break
			}
			log.Printf("💬 Message reçu : %s", p)

			// 3. Mode "Echo"
			if err := conn.WriteMessage(messageType, p); err != nil {
				log.Println("❌ Erreur d'écriture:", err)
				break
			}
		}
	})

	// 5. Lancement du serveur (TOUJOURS EN DERNIER)
	port := ":8080"
	log.Printf("🚀 Serveur à l'écoute sur le port %s", port)
	if err := http.ListenAndServe(port, mux); err != nil {
		log.Fatalf("Erreur du serveur HTTP: %v", err)
	}
}
