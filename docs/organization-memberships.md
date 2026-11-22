# Organization memberships and sessions

Global identity and credentials remain on User. `/api/auth/me` and successful password login return `data.user`, `data.organizations` and `data.active_organization_id`. Send `X-Organization-ID` when selecting HR access. A single active organization can be inferred; multiple organizations require selection for protected HR requests (`409 ORGANIZATION_REQUIRED`). A suspended or removed membership returns `403 MEMBERSHIP_UNAVAILABLE` for HR while global authentication, password changes and access to other organizations remain available.

Organization management uses active membership roles: owner, admin and member. Owners/admins can manage settings and members without an HR profile. Only owners can assign organization owners or alter an owner's membership. HR permissions do not grant organization management roles. Every membership lifecycle write locks the organization before checking its active owners, preventing concurrent removal or demotion of the final owner. Lifecycle changes are audited with their organization and revoke only that organization's sockets after commit.

New organization creation remains disabled unless `ENABLE_ORGANIZATION_CREATION=true`. The creator receives an owner membership and a separately provisioned basic staff HR role/profile. Ownership never supplies wildcard HR grants. No new HR super-admin role is automatically created; existing migrated Stechad HR super-admin grants remain intact. Further HR role assignment uses explicit organization-scoped HR administration/invitations.

| Method | Endpoint | Body / response |
| --- | --- | --- |
| GET | `/api/organizations` | `data.organizations` lists active memberships and organization metadata |
| POST | `/api/organizations` | `{name,slug}`; returns `data.organization` and `data.membership` |
| GET/PATCH | `/api/organizations/:organizationId` | PATCH accepts `{name?,settings?}`; returns `data.organization` |
| GET | `/api/organizations/:organizationId/members` | Organization administrators receive `data.members` |
| PATCH | `/api/organizations/:organizationId/members/:membershipId` | `{membership_role?,status?}`; returns `data.membership` |
| DELETE | `/api/organizations/:organizationId/members/:membershipId` | Marks only the organization membership removed |
| POST | `/api/organizations/:organizationId/leave` | Leaves own membership, preserving the final owner |
| POST | `/api/organizations/:organizationId/invitations` | `{email,role_id,membership_role?,first_name?,last_name?,department_id?,job_title?}`; returns safe `data.invitation` |
| POST | `/api/auth/accept-invite/:token` | Existing accounts supply Bearer authentication; new accounts supply `{new_password,confirm_password,first_name?,last_name?}` |

Invitation emails hold a random single-use bearer; only its SHA-256 digest is stored for new invitations. Existing raw-token invitations remain redeemable until expiration, and a stored digest cannot itself act as a bearer. The service locks the organization and invitation before redemption. Existing invitees must authenticate an active verified global identity whose normalized email matches the invitation; their password and other organizations' profiles remain untouched. New identities verify email through possession of the emailed token and set a validated password. Password login does not itself mark an email verified. Invitations expire after one hour, reject replay, and accept only explicit HR roles belonging to the addressed organization; new super-admin invitations are rejected.

Run the additive `20261121120000-organization-invitations.js` migration through `npm run db:migrate` before using the routes. Run all versioned migrations before the tenancy CLI. Production HR enforcement is composed by server startup after a verified tenancy checkpoint; the authentication middleware permits only test/pre-cutover compatibility for identities with no membership, no selected organization and `TENANCY_ENFORCED` disabled.

Verification uses disposable PostgreSQL schemas: set `MEMBERSHIP_TEST_DATABASE_URL` for the organization HTTP suite and versioned migration CLI suite; set `AUTH_TEST_DATABASE_URL` for existing email/password regression tests. SMTP is captured only at the external mail boundary. These tests cover selected/global sessions, role separation, membership suspension, management without HR, concurrent final-owner departures, invitation identity binding, unchanged existing passwords, concurrent single use, expiration, stored-digest rejection, legacy bearer compatibility, creation gating and Stechad signup provisioning. Live Google OAuth provider delivery requires configured external credentials; Google identities must supply Google's verified-email assertion before provisioning.
