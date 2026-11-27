package module

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/xiant10/t10-modkit/verifier"
)

// signingAuth is auth-server as Auth sees it, signing real tokens: its keys, the service
// token, a person's live session, their entitlements in crm, and an agent's grant chain.
func signingAuth(t *testing.T) (*Auth, func(claims jwt.MapClaims) string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	var srv *httptest.Server
	sign := func(claims jwt.MapClaims) string {
		claims["iss"], claims["exp"] = srv.URL, time.Now().Add(time.Hour).Unix()
		token := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
		token.Header["kid"] = "k1"
		raw, err := token.SignedString(key)
		if err != nil {
			t.Fatal(err)
		}
		return raw
	}
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reply := func(v any) { _ = json.NewEncoder(w).Encode(v) }
		switch r.URL.Path {
		case "/.well-known/jwks.json":
			bytes, _ := key.PublicKey.Bytes()
			reply(map[string]any{"keys": []map[string]string{{"kid": "k1", "kty": "EC", "crv": "P-256",
				"x": base64.RawURLEncoding.EncodeToString(bytes[1:33]), "y": base64.RawURLEncoding.EncodeToString(bytes[33:])}}})
		case "/v1/token":
			reply(map[string]any{"access_token": sign(jwt.MapClaims{"sub": "t10-crm", "aud": []string{"t10"}}), "expires_in": 300})
		case "/v1/me/access":
			reply(map[string]any{"user_id": "usr_1", "active_tenant": "ten_acme"})
		case "/v1/entitlements":
			reply(map[string]any{"tenant_id": "ten_acme", "tenant_status": "active", "module": "crm", "users": []map[string]any{{
				"user_id": "usr_1", "active": true, "account_status": "active", "membership_status": "active", "tenant_admin": false,
				"grants": []map[string]string{{"permission": "crm:use"}}}}})
		case "/v1/grants/gr_1/chain":
			reply(map[string]any{"chain": []map[string]any{{"id": "gr_1", "actions": []string{"crm:read"}, "audiences": []string{"t10-crm"},
				"expires_at": time.Now().Add(time.Hour)}}})
		default:
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(srv.Close)
	v, err := verifier.New(verifier.Config{Issuer: srv.URL, Service: "t10-crm", ClientSecret: "s", HTTPClient: srv.Client()})
	if err != nil {
		t.Fatal(err)
	}
	return &Auth{Module: "crm", Service: "t10-crm", URL: srv.URL, Secret: "s", HTTP: srv.Client(), Verifier: v}, sign
}

// Auth against real tokens, as a module runs with the foundation: a person's own token
// and an agent's delegated one, each answering its caller, and each refused on the other's
// path. v0.2.0 dereferenced a person's absent agent here.
func TestAuthPersonAndAgent(t *testing.T) {
	a, sign := signingAuth(t)
	ctx := context.Background()
	person := "Bearer " + sign(jwt.MapClaims{"sub": "usr_1", "tid": "ten_acme", "sid": "ses_1", "aud": []string{"t10"}})
	agent := "Bearer " + sign(jwt.MapClaims{"sub": "usr_1", "tid": "ten_acme", "aud": []string{"t10-crm"}, "scope": "crm:read",
		"grant": "gr_1", "act": map[string]string{"sub": "agent-ti-crm"}})

	c, err := a.Person(ctx, person)
	if err != nil || c.UserID != "usr_1" || c.TenantID != "ten_acme" || c.Agent != "" || strings.Join(c.Permissions, ",") != "crm:use" {
		t.Fatalf("a person: %+v %v", c, err)
	}
	c, err = a.Agent(ctx, agent, "crm:read")
	if err != nil || c.UserID != "usr_1" || c.Agent != "agent-ti-crm" {
		t.Fatalf("an agent: %+v %v", c, err)
	}
	if _, err := a.Agent(ctx, agent, "crm:propose"); err != ErrForbidden {
		t.Errorf("an agent outside its grant: %v", err)
	}
	if _, err := a.Person(ctx, agent); err != ErrForbidden {
		t.Errorf("an agent's token as a person: %v", err)
	}
	if _, err := a.Agent(ctx, person, "crm:read"); err != ErrForbidden {
		t.Errorf("a person's token as an agent: %v", err)
	}
}
