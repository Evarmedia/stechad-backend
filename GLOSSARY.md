# Stechad platform and HR

Stechad provides a shared identity and organization foundation for an existing HR product and future business products.

## Language

**Global user**:
A person's single account across the suite, independent of any organization or product access.
_Avoid_: Employee account, tenant user

**Organization**:
A company using the platform, with its own members, configuration and business records.
_Avoid_: Company profile, project-manager company

**Membership**:
The relationship between a global user and an organization, including whether that relationship is active, suspended or removed.
_Avoid_: Global account, employee

**Organization administrator**:
A member authorized to manage an organization's settings and memberships. Organization administration does not by itself grant access to sensitive HR records.
_Avoid_: Universal admin

**HR profile**:
A member's employment details, reporting relationships and HR-specific configuration within one organization.
_Avoid_: Global user profile

**HR role**:
An organization's definition of the actions a member may perform within HR.
_Avoid_: Platform role

**HR super admin**:
A member with the highest administrative access within an organization's HR product. Existing Stechad super-admin access has this meaning unless platform authority is separately granted.
_Avoid_: Platform super admin

**Platform administrator**:
An explicitly authorized operator of the shared platform, with authority separate from organization management and HR roles.
_Avoid_: HR super admin

**Talent**:
A candidate or contractor represented in an organization's HR recruitment and delivery workflows; their vetting and onboarding belong to that organization.
_Avoid_: Global candidate pool

**HR project**:
A project managed by the existing HR product, including its managers and talent assignments. It is distinct from a future standalone Projects product.

**HR invoice**:
A staff, talent or project invoice handled by the existing HR product. It is distinct from platform subscription billing and future Finance invoices.
