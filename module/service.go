package module

import (
	"cmp"
	"context"
	"strings"
)

// Service is what a module does as itself, not for a person: its own token, for its own
// clients of auth-server and other services, and a tenant's members, for addressing people.
// Auth is the real one, and Fake answers for its Caller alone, so a module gets it from
// whichever Access NewAccess made: svc := access.(module.Service).
type Service interface {
	ServiceToken(ctx context.Context) (string, error)
	Members(ctx context.Context, tenant string) ([]Member, error)
}

// Member is one active member of a tenant: a person, or an agent with an account of its own.
type Member struct {
	UserID string
	// Name is their display name, or UserID without one.
	Name string
	// Kind is auth-server's: "agent" for an agent's account, otherwise a person.
	Kind string
	// Unit is the name of their org unit (department), empty when they have none or the
	// tenant's units can't be read.
	Unit string
}

// Members are a tenant's active members, from auth-server's org API with the service's own
// token (people's). Nothing is cached, so a module that reads them often keeps its own short
// cache.
func (a *Auth) Members(ctx context.Context, tenant string) ([]Member, error) {
	org := a.people()
	var all []Member
	cursor := ""
	for range 100 {
		page, next, err := org.Search(ctx, tenant, "", "", cursor, 500)
		if err != nil {
			return nil, ErrUnavailable
		}
		for _, m := range page {
			all = append(all, Member{UserID: m.UserID, Name: cmp.Or(strings.TrimSpace(m.DisplayName), m.UserID), Kind: m.Kind, Unit: m.OrgUnitID})
		}
		if cursor = next; cursor == "" {
			break
		}
	}
	// Units name what people do, but without them the members are still the members.
	units := map[string]string{}
	if list, err := org.Units(ctx, tenant); err == nil {
		for _, u := range list {
			units[u.ID] = u.Name
		}
	}
	for i := range all {
		all[i].Unit = units[all[i].Unit]
	}
	return all, nil
}

// ServiceToken is "service" for Fake, which accepts no token of its own.
func (f Fake) ServiceToken(context.Context) (string, error) {
	if f.Down {
		return "", ErrUnavailable
	}
	return "service", nil
}

// Members is Caller alone, in Caller's tenant, and no one in any other.
func (f Fake) Members(_ context.Context, tenant string) ([]Member, error) {
	if f.Down {
		return nil, ErrUnavailable
	}
	if tenant != f.Caller.TenantID {
		return []Member{}, nil
	}
	return []Member{{UserID: f.Caller.UserID, Name: f.Caller.UserID, Kind: "user"}}, nil
}
