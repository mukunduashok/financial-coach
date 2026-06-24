# Feature: User Authentication / Multi-User Support

## Goal
Implement a robust user authentication and authorization system. This is critical for any multi-user application, ensuring data isolation between different users.

## Scope
1.  **Authentication**: Implement standard sign-up/login flows (e.g., email/password, OAuth).
2.  **Authorization**: Ensure all API endpoints (e.g., `/accounts`, `/transactions`) are protected and scoped to the authenticated `user_id`.
3.  **Database**: Update `conversations` and potentially add a `users` table to store user credentials and metadata.
4.  **API Changes**: Update all relevant endpoints to accept and validate a user token/ID.

## Dependencies
- Requires integrating a standard authentication library (e.g., OAuth2 with FastAPI).

## Next Steps
- Define the `User` model in `app/database.py`.
- Implement login/registration endpoints in a new `app/routes/auth.py`.
- Update `app/main.py` to use FastAPI's dependency injection for security.