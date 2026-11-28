package module

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"

	"github.com/xiant10/t10-modkit/ontology"
)

// NewOntology builds the module's ontology (t10-modkit/ontology) and serves it beside what every
// module answers: Register mounts its routes, /mcp lists its generated tools after the module's
// own, and the manifest lists the ontology feature. o needs only what is the module's own, its
// version, stores and errors; Module, Prefix, Authenticate, Who and Can come from m when unset.
// The module then adds its object and action types with ontology.AddObject and AddAction.
func (m *Module) NewOntology(o ontology.Options[Caller]) *ontology.Registry[Caller] {
	if o.Module == "" {
		o.Module = m.ID
	}
	if o.Prefix == "" {
		o.Prefix = m.ID
	}
	if o.Authenticate == nil {
		o.Authenticate = m.ontologyCaller
	}
	if o.Who == nil {
		o.Who = func(c Caller) ontology.Who { return ontology.Who{Tenant: c.TenantID, User: c.UserID} }
	}
	if o.Can == nil {
		o.Can = func(c Caller, permission string) bool {
			return c.TenantAdmin || slices.Contains(c.Permissions, permission)
		}
	}
	m.Ontology = ontology.New(o)
	return m.Ontology
}

// ontologyCaller reads a request's caller for the ontology's routes: a person's own token, or an
// agent's delegated token that allows <id>:read. The routes take an agent's token only for the
// descriptor, so an agent acts only through its tools and their tiers.
func (m *Module) ontologyCaller(r *http.Request) (Caller, ontology.Token, error) {
	header, err := m.bearerOrSession(r)
	if err == nil {
		var c Caller
		if c, err = m.Access.Person(r.Context(), header); err == nil {
			return c, ontology.PersonToken, nil
		}
	}
	if errors.Is(err, ErrUnauthorized) || errors.Is(err, ErrForbidden) {
		if header := r.Header.Get("Authorization"); header != "" {
			c, agentErr := m.Access.Agent(r.Context(), header, m.ID+":read")
			if agentErr == nil {
				return c, ontology.DelegatedToken, nil
			}
			if !errors.Is(agentErr, ErrUnauthorized) && !errors.Is(agentErr, ErrForbidden) {
				err = agentErr
			}
		}
	}
	switch {
	case errors.Is(err, ErrUnauthorized):
		return Caller{}, 0, ontology.Fail(http.StatusUnauthorized, "unauthorized", "")
	case errors.Is(err, ErrForbidden):
		return Caller{}, 0, ontology.ErrForbidden
	}
	return Caller{}, 0, ontology.Fail(http.StatusServiceUnavailable, "authorization_unavailable", "")
}

// ontologyTools are the generated tools as the module's own, each answering its result as the
// ontology wrote it.
func (m *Module) ontologyTools() []Tool {
	if m.Ontology == nil {
		return nil
	}
	var tools []Tool
	for _, t := range m.Ontology.Tools() {
		run := t.Run
		tools = append(tools, Tool{Name: t.Name, Description: t.Description, Action: t.Action, Schema: t.InputSchema,
			ReadOnly: t.Action == m.ID+":read",
			result: func(ctx context.Context, c Caller, args json.RawMessage) map[string]any {
				return run(ontology.WithAgentGrant(ctx, c.AgentAllows), c, c.Agent, args)
			}})
	}
	return tools
}

// features are what the manifest says the module serves beyond what every module answers.
func (m *Module) features() []string {
	if m.Ontology == nil {
		return []string{}
	}
	return []string{"ontology", "auto_apply"}
}
