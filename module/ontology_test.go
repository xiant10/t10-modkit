package module

import (
	"context"
	"strings"
	"testing"

	"github.com/xiant10/t10-modkit/ontology"
	"github.com/xiant10/t10-modkit/ontology/proposals"
	"github.com/xiant10/t10-modkit/ontology/undo"
)

type note struct{ ID, Title string }

// withOntology is testModule with one object type, note, and one action, note.create.
func withOntology(access Access) *Module {
	m := testModule(access)
	reg := m.NewOntology(ontology.Options[Caller]{Version: 1, Proposals: &proposals.Memory{}, Undo: &undo.Memory{}})
	notes := map[string]note{"n1": {"n1", "First"}}
	ontology.AddObject(reg, ontology.ObjectType[Caller, note]{
		Name: "note", Label: "Note", LabelZh: "笔记", Title: "title",
		Properties: map[string]ontology.Property{"title": {Type: ontology.String}},
		Search: func(_ context.Context, c Caller, q ontology.Query) ([]note, error) {
			if q.After != nil {
				return nil, nil
			}
			return []note{notes["n1"]}, nil
		},
		Get: func(_ context.Context, c Caller, id string) (note, error) {
			if n, ok := notes[id]; ok {
				return n, nil
			}
			return note{}, ontology.ErrNotFound
		},
		View: func(_ context.Context, c Caller, n note) ontology.Object {
			return ontology.Object{ID: n.ID, Title: n.Title, Revision: 1, Properties: map[string]any{"title": n.Title}}
		},
	})
	ontology.AddAction(reg, ontology.ActionType[Caller, struct{}]{
		Name: "note.create", Label: "New note", LabelZh: "新建笔记", Permission: "crm:use", Agent: ontology.Propose,
		Params: map[string]ontology.Param{"title": {Type: ontology.String, Required: true}},
		Apply: func(context.Context, Caller, struct{}, ontology.Input) (ontology.Result, error) {
			return ontology.Result{Type: "note", ID: "n1"}, nil
		},
	})
	return m
}

func TestOntologyBesideTheModule(t *testing.T) {
	m := withOntology(Fake{Caller: admin})
	if code, body := serve(t, m, "GET", "/v1/module", "person", ""); code != 200 || !strings.Contains(fmtJSON(body["features"]), "ontology") {
		t.Errorf("manifest: %d %v", code, body)
	}
	if code, _ := serve(t, testModule(Fake{Caller: admin}), "GET", "/v1/module", "person", ""); code != 200 {
		t.Errorf("manifest without an ontology: %d", code)
	}
	if code, body := serve(t, m, "GET", "/v1/ontology", "person", ""); code != 200 || body["module"] != "crm" {
		t.Errorf("descriptor: %d %v", code, body)
	}
	if code, _ := serve(t, m, "GET", "/v1/ontology", "agent", ""); code != 200 {
		t.Errorf("descriptor for an agent: %d", code)
	}
	if code, body := serve(t, m, "GET", "/v1/ontology", "", ""); code != 401 || body["error"] != "unauthorized" {
		t.Errorf("descriptor without a token: %d %v", code, body)
	}
	if code, _ := serve(t, m, "GET", "/v1/objects/note/n1", "person", ""); code != 200 {
		t.Errorf("get: %d", code)
	}
	if code, body := serve(t, m, "GET", "/v1/objects/note/n1", "agent", ""); code != 401 || body["error"] != "person_token_required" {
		t.Errorf("get for an agent: %d %v", code, body)
	}
	if code, _ := serve(t, withOntology(Fake{Down: true}), "GET", "/v1/ontology", "person", ""); code != 503 {
		t.Errorf("descriptor with auth down: %d", code)
	}
}

func TestOntologyTools(t *testing.T) {
	m := withOntology(Fake{Caller: admin})
	_, body := serve(t, m, "POST", "/mcp", "", `{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	listed := fmtJSON(body)
	for _, name := range []string{"crm_echo", "crm_describe", "crm_search", "crm_get", "crm_propose"} {
		if !strings.Contains(listed, `"`+name+`"`) {
			t.Errorf("tools/list has no %s: %s", name, listed)
		}
	}
	if strings.Contains(listed, "crm_act") {
		t.Error("crm_act is listed without an undoable action")
	}
	_, body = serve(t, m, "POST", "/mcp", "agent", call("crm_get", `{"ref":"crm:note:n1"}`))
	if got := fmtJSON(body); !strings.Contains(got, "First") || strings.Contains(got, "isError") {
		t.Errorf("crm_get: %s", got)
	}
	_, body = serve(t, m, "POST", "/mcp", "agent", call("crm_propose", `{"action":"note.create","params":{"title":"Second"}}`))
	if got := fmtJSON(body); strings.Contains(got, "isError") {
		t.Errorf("crm_propose: %s", got)
	}
	_, body = serve(t, m, "GET", "/v1/proposals", "person", "")
	if got := fmtJSON(body); !strings.Contains(got, "Second") || !strings.Contains(got, `"agent"`) {
		t.Errorf("the draft, naming the agent: %s", got)
	}
	// Standalone's read-only agent reads, and can't draft.
	_, body = serve(t, m, "POST", "/mcp", "agent-read", call("crm_get", `{"ref":"crm:note:n1"}`))
	if got := fmtJSON(body); !strings.Contains(got, "First") {
		t.Errorf("crm_get as agent-read: %s", got)
	}
	if code, _ := serve(t, m, "POST", "/mcp", "agent-read", call("crm_propose", `{"action":"note.create","params":{"title":"x"}}`)); code != 403 {
		t.Errorf("crm_propose as agent-read: %d", code)
	}
	// The grant needs the tool's own action.
	narrow := withOntology(Fake{Caller: admin, Actions: []string{"crm:read"}})
	if code, _ := serve(t, narrow, "POST", "/mcp", "agent", call("crm_propose", `{"action":"note.create","params":{"title":"x"}}`)); code != 403 {
		t.Errorf("crm_propose without crm:propose: %d", code)
	}
}

func TestOntologyToolsRefuseMissingArguments(t *testing.T) {
	m := withOntology(Fake{Caller: admin})
	for _, name := range []string{"crm_search", "crm_get", "crm_propose"} {
		_, body := serve(t, m, "POST", "/mcp", "agent", call(name, `{}`))
		if got := fmtJSON(body); !strings.Contains(got, "invalid_arguments") {
			t.Errorf("%s without its required argument: %s", name, got)
		}
	}
}
