// AeroNet OS Portal — secure Grafana iframe gatekeeper.
// Validates JWTs issued by the api-gateway before proxying to Grafana.
// All Grafana traffic is authenticated — no anonymous access.
package main

import (
	"log"
	"net/http"
	"os"
	"time"

	"github.com/aeronet-os/portal/handlers"
	"github.com/aeronet-os/portal/middleware"
)

func main() {
	port := os.Getenv("PORTAL_PORT")
	if port == "" {
		port = "8080"
	}

	mux := http.NewServeMux()

	// Health check — no auth required
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")

		// Security headers
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'self'")

		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok","service":"portal"}`))
	})

	// Grafana proxy — requires valid JWT
	grafanaHandler := middleware.RequireAuth()(
		securityHeaders(handlers.NewGrafanaProxy()),
	)
	mux.Handle("/grafana/", grafanaHandler)
	mux.Handle("/grafana", http.RedirectHandler("/grafana/", http.StatusMovedPermanently))

	srv := &http.Server{
		Addr:         ":" + port,
		Handler:      mux,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 60 * time.Second, // Grafana dashboards can be slow
		IdleTimeout:  120 * time.Second,
	}

	log.Printf("AeroNet Portal listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("portal server error: %v", err)
	}
}

// securityHeaders adds security response headers to all proxied responses.
func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Frame-Options", "SAMEORIGIN")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "strict-origin")
		w.Header().Set("X-XSS-Protection", "1; mode=block")
		next.ServeHTTP(w, r)
	})
}
