ARAB Step 2D - Authentication Middleware

This replacement middleware/auth.js was built from the user's attached
middleware/auth.js.

It preserves the existing database-backed session system and adds:
- requireAdmin()
- requireFinance()
- requireOfficial()
- hasRole()
- requireLinkedOfficial()
- requireOwnOfficialParam()
- isOwnOfficial()

It does NOT change the PostgreSQL users table or convert the TO role.
Those changes should be handled separately after the current login system
has been confirmed working.

INSTALLATION
1. Back up your current project/middleware/auth.js.
2. Replace it with:
   middleware/auth.js
3. Restart:
   node app.js
