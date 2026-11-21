# Preserve global identity while separating organization-specific HR state

The existing User combines credentials, one role and employment details, but a person must be able to work in several organizations with different HR access. Keep one global identity and introduce memberships plus organization-owned HR profiles and roles; retain legacy fields only during the expand–migrate–contract transition so existing Stechad data and API behavior can be preserved. Membership removal affects only that organization, and existing HR super-admin access does not automatically confer platform authority; this trades temporary compatibility code for a migration that preserves current users and supports independent organizations.

Accepted in the user's Phase 1 approval. The implementation scope and verification requirements are tracked in [the Phase 1 specification](https://github.com/Evarmedia/stechad-backend/issues/1).
