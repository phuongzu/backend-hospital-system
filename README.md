# Healthcare Backend API

## Setup Instructions

### 1. Install Dependencies
```bash
npm install
```

### 2. Environment Variables
Create a `.env` file in the backend directory with the following variables:

```env
# Database Configuration
MONGODB_URI=mongodb://localhost:27017/healthcare

# JWT Configuration
JWT_SECRET=your_super_secret_jwt_key_here_make_it_long_and_random
JWT_REFRESH_SECRET=your_super_secret_refresh_key_here_make_it_long_and_random

# Server Configuration
PORT=3000

# Frontend URL (comma-separated for multiple origins)
FRONTEND_URL=http://localhost:3000,http://localhost:19006
```

### 3. Start Development Server
```bash
npm run dev
```

The server will run on port 3000 by default.

## API Endpoints

### Authentication Routes (`/api/auth`)
- `POST /register` - User registration
- `POST /login` - User login
- `POST /refresh-token` - Refresh access token
- `GET /profile` - Get user profile (protected)
- `PUT /profile` - Update user profile (protected)
- `POST /change-password` - Change password (protected)
- `POST /logout` - Logout user (protected)

## Fixed Issues

1. **Password Double Hashing**: Removed automatic password hashing from User model to prevent conflicts with manual hashing in auth controller
2. **Port Configuration**: Changed default port from 5000 to 3000
3. **Environment Variables**: Added validation for required environment variables
4. **JWT Security**: Removed hardcoded fallback secrets
5. **Dependencies**: Removed unused 'protect' package
6. **Error Handling**: Improved error handling throughout the application
