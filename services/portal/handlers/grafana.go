// Package handlers provides the Grafana reverse proxy handler.
// Strips the /grafana prefix, injects Grafana auth headers,
// and rewrites Location headers on redirects.
package handlers

import (
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
)

// NewGrafanaProxy returns an http.Handler that proxies /grafana/* to Grafana.
// Grafana URL is read from GRAFANA_URL env var (default: http://grafana:3000).
// Grafana admin credentials are injected via basic auth header so the portal
// acts as a trusted gateway — end users never see Grafana credentials.
func NewGrafanaProxy() http.Handler {
	grafanaURL := os.Getenv("GRAFANA_URL")
	if grafanaURL == "" {
		grafanaURL = "http://grafana:3000"
	}

	target, err := url.Parse(grafanaURL)
	if err != nil {
		panic("invalid GRAFANA_URL: " + err.Error())
	}

	proxy := httputil.NewSingleHostReverseProxy(target)

	// Rewrite: strip /grafana prefix before forwarding
	originalDirector := proxy.Director
	proxy.Director = func(req *http.Request) {
		originalDirector(req)
		req.URL.Path = strings.TrimPrefix(req.URL.Path, "/grafana")
		if req.URL.Path == "" {
			req.URL.Path = "/"
		}
		req.Host = target.Host

		// Inject Grafana basic auth — portal is a trusted internal gateway
		adminUser := os.Getenv("GRAFANA_ADMIN_USER")
		adminPass := os.Getenv("GRAFANA_ADMIN_PASSWORD")
		if adminUser != "" && adminPass != "" {
			req.SetBasicAuth(adminUser, adminPass)
		}

		// Remove Authorization header so Grafana doesn't see the user's JWT
		req.Header.Del("Authorization")
	}

	// Rewrite Location headers on redirects so /login becomes /grafana/login
	proxy.ModifyResponse = func(res *http.Response) error {
		if loc := res.Header.Get("Location"); loc != "" {
			if strings.HasPrefix(loc, "/") && !strings.HasPrefix(loc, "/grafana") {
				res.Header.Set("Location", "/grafana"+loc)
			}
		}
		return nil
	}

	return proxy
}
