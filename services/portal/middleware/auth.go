// Package middleware provides JWT validation for the portal proxy.
// Validates tokens issued by the api-gateway using the shared SECRET_KEY.
package middleware

import (
	"context"
	"net/http"
	"os"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const ClaimsKey contextKey = "claims"

type Claims struct {
	Sub    string  `json:"sub"`
	Role   string  `json:"role"`
	SiteID *string `json:"site_id"`
	jwt.RegisteredClaims
}

// RequireAuth validates the Bearer JWT from the Authorization header.
// Writes 401 on missing/invalid token.
func RequireAuth() func(http.Handler) http.Handler {
	secretKey := os.Getenv("SECRET_KEY")

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if !strings.HasPrefix(authHeader, "Bearer ") {
				http.Error(w, "missing authorization header", http.StatusUnauthorized)
				return
			}

			tokenStr := strings.TrimPrefix(authHeader, "Bearer ")
			claims := &Claims{}

			_, err := jwt.ParseWithClaims(
				tokenStr, claims,
				func(t *jwt.Token) (interface{}, error) {
					if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
						return nil, jwt.ErrSignatureInvalid
					}
					return []byte(secretKey), nil
				},
			)
			if err != nil {
				http.Error(w, "invalid or expired token", http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), ClaimsKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}
