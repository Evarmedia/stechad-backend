# PROJECT HANDOVER: MULTI-PRODUCT, MULTI-TENANT BUSINESS SOFTWARE SUITE

## 1. Project Overview

I am building a multi-product business management SaaS platform, similar in concept to Zoho One.

The project already has an existing HR and staff management application with substantial functionality. The current HR application is similar to Zoho People or Notch HR, excluding payroll.

The long-term goal is to evolve the existing application into a unified business software suite where organizations can subscribe to and use multiple independent business products from one platform.

The planned products include:

1. **HR Product:** The Existing application, including staff, departments, leave, attendance, recruitment, performance management, and other current features.
2. **CRM:** Leads, contacts, customers, opportunities, sales pipelines, activities, and campaigns.
3. **Finance:** Expenses, business invoices, budgets, financial transactions, and related financial management.
4. **Project Management:** Projects, tasks, milestones, timesheets, resources, and project collaboration.

More products may be introduced in the future.

The platform should support independent product subscriptions while providing a unified experience for organizations and their users.

**Important:** You have direct access to the existing codebase. The repository is the source of truth about the current implementation. Do not assume its framework, database, authentication architecture, folder structure, or existing data models. Inspect them before proposing implementation changes.

---

## 2. Overall Product Vision

The intended experience is:

- A user creates one account.
- The user can create or join multiple organizations.
- Each organization can subscribe to different products.
- Each organization manages its members and their product access.
- Each product has its own permissions and roles.
- Users access all their authorized products through one unified dashboard.
- Organizations can independently manage subscriptions, seats, and product usage.
- Each product can have its own marketing website and signup entry point.
- The platform has a separate internal administration system for platform-wide management.

For example:

An organization may subscribe to HR and CRM but not Finance or Projects.

Another organization may subscribe to all four products.

A user may belong to multiple organizations and have different permissions in each organization.

The architecture must support this without creating separate user accounts for each product or organization.

---

## 3. Agreed Architectural Decisions

These are the architectural decisions established for the project.

| Area | Decision |
|---|---|
| Architecture | Modular monolith |
| Backend design | Clean Architecture principles within modules |
| Frontend | React/TypeScript monorepo |
| Monorepo tooling | Turborepo or Nx, subject to repository inspection |
| Database | PostgreSQL, subject to current implementation review |
| Tenancy | Multi-tenant SaaS |
| Identity | One global user identity |
| Organization membership | A user can belong to multiple organizations |
| Product ownership | Each product owns its business entities |
| Product roles | Each product defines predefined role templates |
| Role customization | Organizations can customize their own role copies and permissions |
| Product activation | Both self-service activation and platform-admin provisioning |
| Customer experience | One unified authenticated dashboard |
| Product navigation | Product switcher |
| Authentication | Centralized/shared identity and authentication |
| Pricing | Organization plans + seats + usage limits |
| Platform administration | Separate platform-level super-admin capability |
| Product marketing | Each product may have its own landing page or mini-website |
| Customer application | Unified authenticated application |
| Admin application | Separate internal platform administration application |

These decisions describe the intended architecture. They do not authorize blindly rebuilding existing components to match a theoretical structure.

---

## 4. Multi-Tenancy and Identity Architecture

This is the most important foundational requirement.

The system must support one global user identity with multiple organization memberships.

### Global users

A user should have one account across the entire platform.

A user should not need separate accounts to access HR, CRM, Finance, or Projects.

### Organizations

An organization represents a tenant/company using the platform.

Each organization should have its own settings, members, product subscriptions, permissions, and business data.

### Memberships

A membership represents the relationship between a user and an organization.

A user may belong to multiple organizations.

For example:

- User A belongs to Organization X as an HR Admin.
- The same User A belongs to Organization Y as a Staff Member.
- The same User A may have CRM access in Organization X but no CRM access in Organization Y.

**Important:** Do not store one `organization_id` or one organization-specific `role_id` directly on the global user record as the basis of tenant membership.

### Expected capabilities

The platform must support:

- Account registration and login.
- Organization creation.
- Organization selection.
- Organization switching.
- Retrieving all organizations a user belongs to.
- Inviting users into organizations.
- Accepting invitations.
- Removing members.
- Leaving organizations.
- Suspending or deactivating memberships.
- Managing organization settings.

### Tenant isolation

Every tenant-owned business record must be scoped to its organization.

The backend must validate organization membership and access permissions before returning or modifying tenant-owned data.

Never trust an organization ID supplied by the frontend without validating it against the authenticated user's membership and authorization.

The implementation must prevent:

- Accessing another organization's records by manipulating IDs.
- Reading records from another tenant through unscoped database queries.
- Updating or deleting records belonging to another organization.
- Access through stale or suspended memberships.
- Cross-tenant access caused by concurrent requests or incorrect request context handling.

Use tenant-scoped repository methods and appropriate database constraints.

PostgreSQL Row-Level Security (RLS) can be evaluated as an additional security layer, but it must not replace application-level authorization.

Tenant isolation must be covered by automated tests.

---

## 5. Platform Administration and Super Admin

The platform should have a separate internal administration capability.

This is different from an organization's administrator.

### Platform Super Admin

A platform super-admin should be able to:

- View and manage organizations across the platform.
- View and manage global users.
- Activate or suspend organizations.
- Activate or provision products for organizations.
- Manage the product catalog.
- Manage product plans and subscriptions.
- View billing and usage information.
- Manage platform-level role templates and permissions.
- View audit logs.
- Monitor platform activity.
- Investigate support issues.

### Organization Admin

An organization admin should be able to:

- Manage their organization.
- Invite and remove members.
- Manage organization settings.
- Manage product subscriptions.
- Activate products where permitted.
- Assign users to products.
- Manage organization-specific roles and permissions.

An organization admin should not automatically have unrestricted access to every product's sensitive data.

### Product Admin

Each product should have its own administrative role.

Examples:

- HR product super admin/Admin
- CRM Admin
- Finance Admin
- Projects Admin

A Finance Admin should not automatically have HR Admin privileges.

### Platform security

Platform administration must use a separate platform-level authorization model.

Recommended safeguards:

- MFA for privileged platform accounts.
- Least-privilege permissions.
- Backend authorization checks.
- Audit logging for sensitive actions.
- Reasons for organization suspension and privileged overrides.
- Time-limited and audited support access where staff need to investigate customer data.

Do not rely on hiding admin pages in the frontend as a security mechanism.

---

## 6. Product Catalog and Product Activation

Products must be independently manageable and activatable.

An organization should be able to subscribe to HR without subscribing to CRM, Finance, or Projects.

### Product activation methods

Support both:

1. **Self-service activation:** An organization admin selects a product and activates it through the platform.
2. **Platform-admin activation:** An internal platform administrator provisions a product for an organization.

Both methods should use the same underlying product activation service.

Activation should handle:

- Product availability validation.
- Subscription or trial validation.
- Entitlement provisioning.
- Product role-template initialization.
- Audit logging.
- Organization-product status updates.

Activating a product must not automatically grant every organization member access to it.

Product access should be assigned separately.

---

## 7. Product Roles and Permissions

Each product should define its own permission system and default role templates.

For example:

**HR product (Current Product)**
- HR superadmin/Admin
- talent
- Staff
- pm ...etc

**CRM**
- CRM Admin
- Sales Manager
- Sales Representative

**Finance**
- Finance Admin
- Accountant
- Finance Viewer

**Projects**
- Projects Admin
- Project Manager
- Project Member

These are illustrative roles, not a requirement to implement exactly these names.

### Role customization

When a product is activated for an organization:

1. The platform retrieves that product's predefined role templates.
2. The system creates organization-specific copies of those templates.
3. The organization can customize role names and permissions.
4. The organization can create additional custom roles.
5. Changes made by one organization must not affect another organization.

For example, Organization A may customize its HR Manager permissions without changing Organization B's HR Manager role.

### Template versioning

Product role templates should be versioned.

When a product introduces new default permissions or role templates, existing organizations should not silently lose their customizations.

Provide a controlled upgrade process that can show changes and allow organizations to adopt them.

### Authorization

Use product-scoped RBAC, with resource-level or attribute-level authorization where needed.

For example, a Project Manager may only be permitted to manage projects assigned to them.

Do not create one universal Admin role that grants unrestricted access to every product.

---

## 8. Product Access and Entitlements

There are several different concepts that must remain separate.

1. **Product subscription:** The organization has subscribed to a product.
2. **Product assignment:** A specific member is allowed to access that product.
3. **Feature entitlement:** The organization's plan includes a feature or usage allowance.
4. **Permission:** The user is authorized to perform a particular action.
5. **Feature flag:** A technical mechanism for controlling feature rollout or experimentation.

These should not be treated as interchangeable.

For every protected product request, the backend should validate:

1. Authentication.
2. Active organization membership.
3. Active subscription or permitted trial.
4. Product assignment for the member.
5. Feature entitlement and usage allowance, where applicable.
6. Product role permission.
7. Resource-level authorization.

The frontend can hide unavailable products and actions for usability, but the backend must enforce every restriction.

---

## 9. Subscription and Pricing Architecture (powered by Paystack with accomodation to support other payment processors)

The pricing model should combine:

- Organization-level plans.
- Seat-based pricing.
- Usage-based pricing or limits.

Each product should have independent plans and subscriptions.

For example:

An organization may subscribe to:

- HR Professional.
- CRM Basic.
- Projects Starter.

The organization should not need to subscribe to one large bundle to use multiple products.

### Subscription requirements

The platform should support:

- Free plans.
- Paid plans.
- Trials.
- Included seats.
- Additional seats.
- Usage limits.
- Metered usage.
- Upgrades.
- Downgrades.
- Renewals.
- Cancellations.
- Past-due subscriptions.
- Grace periods.
- Suspension.
- Subscription history.

One organization billing account may pay for multiple product subscriptions, while each product retains its own subscription and entitlement rules.

### Important billing considerations

- Preserve historical prices on invoice lines.
- Do not calculate historical invoices from current plan prices.
- Define how pending invitations affect seat counts.
- Define whether seats count active product assignments or all organization members.
- Track usage by organization, product, feature, and billing period.

Recommended seat-counting approach: count active product assignments, with an explicitly defined policy for pending invitations.

---

## 10. Product Data Ownership

Each product must own its business entities and domain rules.

### Platform-owned entities

The shared platform owns:

- Users.
- Organizations.
- Memberships.
- Invitations.
- Identity and authentication.
- Platform-level authorization.
- Product catalog.
- Product activation.
- Subscription infrastructure.
- Entitlements.
- Billing.
- Audit logs.
- Shared notifications and files infrastructure.

### HR-owned entities (all current product entities)

- staff.
- Departments.
- Leave.
- Attendance.
- Recruitment.
- Project management.
- KPI Performance management.
- etc

### CRM-owned entities

- Leads.
- Contacts.
- Opportunities.
- Sales pipelines.
- Activities.
- Campaigns.

### Finance-owned entities

- Expenses.
- Business invoices.
- Budgets.
- Financial transactions.
- Other financial records.

### Projects-owned entities (different from current project management - complete product on its own)

- Projects.
- Tasks.
- Milestones.
- Timesheets.
- Resources.
- Project memberships.

### Product boundaries

Products should not directly manipulate each other's repositories or database tables.

Cross-product communication should use:

- Explicit internal module interfaces for synchronous operations.
- Domain events for asynchronous communication.
- Local projections where read models are required.
- A transactional outbox where reliable event publishing is necessary.

Do not create a universal Person table simply because HR, CRM, and Projects all reference people. A staff, a lead, a customer contact, and a project contributor may represent different business concepts.

Cross-product references should use explicit IDs and validated integration contracts.

Also distinguish between:

- Platform billing invoices.
- Business invoices created through the Finance product.

These are different concepts.

---

## 11. Frontend Architecture

The intended frontend direction is a React/TypeScript monorepo.

Possible tooling includes Turborepo or Nx, but choose based on the actual repository and migration cost.

### Unified customer application

The customer-facing application should contain:

- Authentication.
- Organization selector.
- Main dashboard.
- Product switcher.
- HR.
- CRM.
- Finance.
- Projects.
- Organization settings.
- Member management.
- Product subscription management.

### Platform admin application

A separate internal administration application should provide platform-wide management.

It may share the same identity infrastructure but must have separate authorization and navigation.

### Marketing websites

Each product should be able to have its own marketing website or mini-website.

Example domains:

- `hr.yoursuite.com`
- `crm.yoursuite.com`
- `finance.yoursuite.com`
- `projects.yoursuite.com`

Shared authentication:

- `accounts.yoursuite.com`

Unified application:

- `app.yoursuite.com`

Platform admin:

- `admin.yoursuite.com`

These are illustrative domain names.

Initially, product landing pages may share one configurable marketing application with different product content, branding, and domains. There is no need to maintain four completely independent marketing applications unless business requirements justify it.

### Product-specific login entry points

A user visiting the HR website should be able to click Login or Get Started.

The login process should use the centralized identity system while preserving the intended destination.

For example:

1. User visits HR landing page.
2. User clicks Get Started.
3. User is redirected to centralized authentication.
4. User logs in or registers.
5. User creates an organization or submits organisation code to join existing one.
6. User activates HR through an appropriate plan or trial.
7. User enters the unified application with HR selected.

An existing user should be able to activate CRM or another product without creating another account.

The exact authentication/session implementation must be selected after inspecting the current codebase and domain setup.

---

## 12. Backend Architecture

The intended backend architecture is a modular monolith using Clean Architecture principles within each module.

The goal is to maintain strong domain boundaries without prematurely introducing microservices.

Each module should have clear separation between:

- Domain: entities, value objects, domain services, and business rules.
- Application: use cases, commands, queries, and interfaces.
- Infrastructure: repositories, persistence, integrations, and technical implementations.
- Presentation: controllers, routes, request validation, and response mapping.

MVC can be used within the presentation layer. It does not need to define the architecture of the entire backend.

### Suggested module boundaries

**Platform**
- Identity.
- Organizations.
- Memberships.
- Invitations.
- Platform administration.
- Authorization.
- Product catalog.
- Product activation.
- Subscriptions.
- Entitlements.
- Billing.
- Notifications.
- Audit.
- Files.

**Products**
- HR(Current Product)
- CRM.
- Finance.
- Projects.

**Shared infrastructure**
- Database.
- Logging.
- Error handling.
- Events.
- Messaging.
- Cache.
- Storage.
- Background jobs.

This is a conceptual boundary map, not an instruction to generate these folders blindly. Inspect the existing architecture and propose the least disruptive implementation.

---

## 13. Implementation Roadmap

The project should be implemented in phases.

Do not attempt to implement the entire suite at once.

### Phase 1: Multi-Tenancy Foundation

This is the first implementation priority.

Focus on:

- Global users.
- Organizations.
- Memberships.
- Invitations.
- Organization settings.
- Organization creation.
- Organization switching.
- Active organization context.
- Tenant-scoped data access.
- Cross-tenant isolation.
- Database constraints and indexes.
- Automated tenant isolation tests.

Review existing HR(current Product) entities and identify which records need organization ownership.

Preserve existing HR(current Product) data and functionality.

write a script to migrate current existing data to the new tenant scoped database, it should all belong to an tenant organisation called "stechad" without damage or change to current access, roles or functionalities. if its better to do this in a different phase let me know and add it to your plans

Do not proceed until tenant isolation is tested and reviewed.

### Phase 2: Authentication and Platform Authorization

Implement or adapt:

- Centralized identity and authentication.
- Session management.
- Platform roles.
- Platform permissions.
- Global Super-admin access.
- Organization-level authorization.
- Secure platform administration.

### Phase 3: Product Management and Access

Implement:

- Product catalog.
- Organization-product activation.
- Self-service activation.
- Platform-admin provisioning.
- Product assignments.
- Product role templates.
- Organization-specific role instances.
- Custom roles and permissions.

### Phase 4: Subscriptions and Entitlements (powered by paystack, room to accomodate other payment processors, so user's can chose which to to pay with)

Implement:

- Product plans.
- Organization subscriptions.
- Trials.
- Seats.
- Usage tracking.
- Feature entitlements.
- Billing integration and history.

### Phase 5: Unified Frontend

Implement or adapt:

- Organization selector.
- Product switcher.
- Unified dashboard.
- Product navigation.
- Organization settings.
- Subscription management.

### Phase 6: HR(current product) Modularization

Gradually adapt the existing HR application.

- Preserve existing functionality.
- Introduce organization scoping.
- Integrate HR roles and permissions.
- Integrate HR subscription entitlements.
- Validate tenant isolation.
- Avoid unnecessary rewrites.

### Phase 7: CRM

Build CRM as an independent product module with its own domain entities, roles, permissions, and entitlements.

### Phase 8: Finance

Build Finance as an independent product module.

### Phase 9: Projects

Build Projects as an independent product module.

### Phase 10: Cross-Product Integrations

Introduce integrations between products using explicit interfaces and domain events.

Examples:

- HR employee information referenced by Projects.
- CRM customer information referenced by Finance.
- Project timesheets feeding relevant Finance workflows.

Cross-product integrations should be designed carefully to preserve ownership boundaries.

---

## 14. AI Coding Agent Working Instructions

You have direct access to the existing project repository.

Your responsibility is to evolve the existing application into the intended platform, not to recreate the project from scratch.

### A. Inspect before implementing

Before making any changes:

1. Inspect the existing repository.
2. Identify the actual frontend and backend technologies.
3. Identify the database and ORM/query layer.
4. Inspect authentication and authorization.
5. Inspect the existing HR architecture and business entities.
6. Identify how organization or tenant ownership is currently represented.
7. Identify code that assumes one user belongs to one organization.
8. Identify existing tests and development workflows.
9. Identify any architectural constraints that could affect the proposed design.

Do not assume anything that can be verified from the repository.

### B. Report findings before editing

Your first deliverable must be an assessment report containing:

- Current architecture.
- Existing authentication flow.
- Existing user and organization models.
- Existing HR domain structure.
- Database and migration approach.
- Current authorization approach.
- Potential multi-tenancy risks.
- Existing features that may be affected.
- Recommended implementation strategy.
- Proposed database changes.
- Proposed API changes.
- Risks and migration considerations.

Do not write or overwrite code before presenting this report and receiving approval.
Do not write/create to many unnessary markdown files.

### C. Work incrementally

After approval:

1. Implement only the approved phase.
2. Follow existing coding conventions where reasonable.
3. Avoid unnecessary dependencies.
4. Avoid unnecessary rewrites.
5. Add appropriate validation and error handling.
6. Add database migrations.
7. Write automated tests.
8. Run existing and new tests.
9. Report implementation results.
10. Wait for review before proceeding to the next phase.

### D. Preserve existing functionality

The existing HR application is a functioning product and must be treated as such.

Do not:

- Replace working features without justification.
- Delete existing business logic casually.
- Rebuild authentication simply because another approach is theoretically preferable.
- Introduce microservices prematurely.
- Duplicate existing shared functionality.
- Make destructive database changes without a migration and data-preservation plan.

Where existing architecture conflicts with the target architecture, explain the conflict and propose a migration strategy.

### E. Security requirements

Security must be treated as a core requirement, especially for multi-tenancy.

Never rely solely on frontend checks.

All tenant-sensitive operations must be validated on the backend.

Write tests for unauthorized and cross-tenant access.

Do not expose sensitive data in logs or API responses.

### F. Communication and approvals

At the end of each phase, provide in one doc, straight to the point and brief:

- What was inspected.
- What was implemented.
- Files and modules changed.
- Database migrations added.
- API endpoints added or modified.
- Tests written.
- Test results.
- Security considerations.
- Known limitations.
- Outstanding decisions.
- Recommended next phase.

Do not automatically proceed to the next phase.

Wait for explicit approval.

---

## 15. Immediate Task: Phase 1 Inspection

We are starting with multi-tenancy.

However, do not immediately implement multi-tenancy.

Your first task is to inspect the existing codebase and prepare an implementation assessment.

Specifically, investigate:

1. How users are currently registered and authenticated.
2. How organizations or companies are represented.
3. Whether users currently belong to one organization or multiple organizations.
4. How roles and permissions are currently stored and checked.
5. Which HR records are organization-specific.
6. Which APIs retrieve, create, update, and delete HR records.
7. Whether database queries currently enforce organization ownership.
8. Whether any existing feature assumes a single organization per user.
9. How migrations and existing data can be handled safely.
10. How the new tenancy foundation can be introduced without breaking existing users.

### Expected first response

Do not generate code yet.

Present:

- A concise overview of the current architecture discovered in the repository.
- Existing identity and organization relationships.
- Existing HR data ownership.
- Current security and authorization approach.
- Multi-tenancy gaps.
- Recommended target data model based on the existing implementation.
- Proposed migration strategy.
- API and middleware changes required.
- Potential breaking changes.
- A phased implementation plan for Phase 1.
- Automated tests required to prove tenant isolation.

Then wait for my approval before editing anything.

---

## 16. Final Architectural Principles

Keep these principles in mind throughout development:

1. One global identity across the suite.
2. Users can belong to multiple organizations.
3. Organization membership and product access are separate.
4. Organizations subscribe to products independently.
5. Each product owns its own business entities.
6. Each product has its own roles and permissions.
7. Organization-specific role customizations must not affect other organizations.
8. Platform administration is separate from organization administration.
9. One unified authenticated customer application.
10. Product-specific marketing websites can share centralized authentication.
11. Subscription entitlements, user permissions, and feature flags are separate concepts.
12. Every tenant-owned record must be securely isolated.
13. The backend is the authority for authentication, tenancy, entitlements, and authorization.
14. Prefer modular monolith architecture over premature microservices.
15. Preserve existing working HR functionality.
16. Build incrementally and test each phase before proceeding.

**The immediate objective is not to build the entire business suite. It is to safely evolve the existing application into a properly designed multi-tenant foundation that can support the future products without requiring another major architectural rewrite.**

** If neccesarry and not handled by skills Create a tracking document you can always refer to with the entire plan and phases, and for everyone completed, mark it on the document as completed that way you can always continue from where you stopped. **