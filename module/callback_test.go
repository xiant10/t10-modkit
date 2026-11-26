package module

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// The code exchange goes through websession's client, and answers as it always did: a
// refused code is 401, an auth-server that's down 503, and a good one a session cookie.
func TestCallbackRedeemsTheCode(t *testing.T) {
	status := http.StatusOK
	var form url.Values
	auth := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/token" || r.ParseForm() != nil {
			w.WriteHeader(404)
			return
		}
		form = r.PostForm
		w.WriteHeader(status)
		if status == http.StatusOK {
			w.Write([]byte(`{"access_token":"tok","expires_in":3600}`))
		} else {
			w.Write([]byte(`{"error":"invalid_grant"}`))
		}
	}))
	defer auth.Close()
	t.Setenv("AUTH_ISSUER", "http://auth.example")
	t.Setenv("AUTH_URL", auth.URL)
	t.Setenv("AUTH_WEB_CLIENT_SECRET", "web-secret")
	m := testModule(Fake{Caller: admin})
	m.PublicURL = "http://app.example"
	mux := webMux(m)

	callback := func() *httptest.ResponseRecorder {
		sealed, err := m.seal("st\nver\n/t/ten_acme/")
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest("GET", "/auth/callback?state=st&code=c1", nil)
		req.AddCookie(&http.Cookie{Name: m.oauthCookieName(), Value: sealed})
		return do(mux, req)
	}
	w := callback()
	if w.Code != http.StatusSeeOther || w.Header().Get("Location") != "/t/ten_acme/" || !strings.Contains(strings.Join(w.Header().Values("Set-Cookie"), "\n"), m.sessionCookieName()+"=") {
		t.Fatalf("a good code: %d %v", w.Code, w.Header())
	}
	if form.Get("code") != "c1" || form.Get("code_verifier") != "ver" || form.Get("client_id") != m.Service+"-web" || form.Get("client_secret") != "web-secret" ||
		form.Get("redirect_uri") != "http://app.example/auth/callback" {
		t.Errorf("the exchange sent %v", form)
	}
	status = http.StatusBadRequest
	if w := callback(); w.Code != http.StatusUnauthorized {
		t.Errorf("a refused code: %d", w.Code)
	}
	auth.Close()
	if w := callback(); w.Code != http.StatusServiceUnavailable {
		t.Errorf("auth-server down: %d", w.Code)
	}
}
