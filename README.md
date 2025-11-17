# 🎓 Online Tutoring Registration System

A beautiful, modern web application for managing student registrations and Zoom class access with international phone number support.

## ✨ Features

- **🌍 International Phone Support**: 50+ countries with flag icons and validation
- **📱 Responsive Design**: Works perfectly on all devices
- **🎨 Stunning UI/UX**: Modern glassmorphism, smooth animations, gradient backgrounds
- **🔐 Secure Authentication**: Firebase-powered teacher login
- **⚡ Real-time Updates**: Instant synchronization with Firestore
- **📊 Teacher Dashboard**: Comprehensive student management and analytics
- **🔗 Zoom Integration**: Automatic redirect to class sessions
- **💾 Data Export**: CSV export functionality
- **🌓 Morning/Evening Sessions**: Separate registration flows

## 🚀 Quick Start

### Prerequisites

- Modern web browser
- Firebase account (already configured)
- Local web server or hosting platform

### Installation

1. **Clone or download** this project to your local machine

2. **Verify Firebase Configuration**
   - Firebase credentials are already set up in `js/firebase-config.js`
   - Project ID: `online-tutoring-6d71a`

3. **Deploy Firestore Security Rules**
   - Go to Firebase Console → Firestore Database → Rules
   - Copy the rules from `firestore.rules`
   - Click "Publish"

4. **Run Locally**
   ```bash
   # Using Python
   python -m http.server 8000
   
   # Using Node.js
   npx http-server
   
   # Using PHP
   php -S localhost:8000
   ```

5. **Open in browser**
   ```
   http://localhost:8000
   ```

## 📁 Project Structure

```
online-tutoring/
├── index.html              # Landing page
├── morning.html            # Morning session registration
├── evening.html            # Evening session registration
├── dashboard.html          # Teacher dashboard
├── css/
│   └── styles.css         # Modern UI styles
├── js/
│   ├── firebase-config.js  # Firebase initialization
│   ├── countries.js        # Country data & validation
│   ├── student-app.js      # Student registration logic
│   └── dashboard-app.js    # Dashboard functionality
├── firebase-config/
│   └── [Firebase credentials]
└── README.md
```

## 🎯 User Flows

### Students

1. **Select Session**: Choose Morning or Evening from landing page
2. **Select Country**: Pick country from dropdown with flag
3. **Enter Phone**: Input parent's phone number
4. **Check Status**:
   - **New Student**: Fill registration form (name, class, subjects, payment)
   - **Returning Student**: Welcome back screen with 3-second countdown
5. **Join Class**: Automatic redirect to Zoom meeting

### Teachers

1. **Login**: Access dashboard with teacher credentials
2. **Setup Zoom Links**: Add/update morning and evening Zoom URLs
3. **View Students**: Browse registrations by session
4. **Manage**: Delete students or export to CSV
5. **Share Links**: Copy registration links for students

## 🔧 Configuration

### Firebase Setup (Already Done ✅)

Your Firebase project is already configured:
- **Project ID**: online-tutoring-6d71a
- **Firestore**: Enabled
- **Authentication**: Email/Password enabled

### Adding Teacher Account

1. Go to Firebase Console
2. Navigate to Authentication
3. Add user with teacher email/password
4. Teachers can now log in to the dashboard

### Setting Zoom Links

1. Log in to teacher dashboard
2. Paste Zoom meeting URLs for morning/evening
3. Click "Add Link" or "Update Link"
4. Share registration links with students

## 🌍 Supported Countries

The system supports 50+ countries with automatic phone validation:

- 🇰🇪 Kenya (+254)
- 🇺🇸 United States (+1)
- 🇬🇧 United Kingdom (+44)
- 🇦🇺 Australia (+61)
- 🇮🇳 India (+91)
- 🇿🇦 South Africa (+27)
- 🇳🇬 Nigeria (+234)
- And 40+ more...

Each country has:
- Flag emoji
- Dial code
- Phone number format
- Automatic validation

## 🎨 UI/UX Features

- **Glassmorphism Effects**: Modern frosted glass cards
- **Smooth Animations**: Fade, slide, scale transitions
- **Gradient Backgrounds**: Beautiful color schemes
- **Micro-interactions**: Hover effects, button ripples
- **Responsive Design**: Perfect on mobile, tablet, desktop
- **Loading States**: Spinners and progress indicators
- **Toast Notifications**: Non-intrusive feedback
- **Modal Dialogs**: Confirmation prompts

## 📊 Database Structure

```
Firestore Collections:
├── config/
│   └── zoomLinks/
│       ├── morning: "https://zoom.us/..."
│       ├── evening: "https://zoom.us/..."
│       └── timestamps
├── sessions/
│   ├── morning/
│   │   └── {phoneNumber}/
│   │       ├── studentName
│   │       ├── class
│   │       ├── subjects
│   │       ├── receiptMessage
│   │       └── timestamps
│   └── evening/
│       └── {phoneNumber}/
│           └── [same structure]
```

## 🔒 Security

- Firebase security rules enforce data validation
- Teacher authentication required for sensitive operations
- Students can only create/read their own data
- XSS protection with HTML escaping
- Phone number validation before database writes

## 📱 Browser Support

- ✅ Chrome 90+
- ✅ Firefox 88+
- ✅ Safari 14+
- ✅ Edge 90+
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

## 🚀 Deployment Options

### Option 1: Firebase Hosting

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Initialize
firebase init hosting

# Deploy
firebase deploy
```

### Option 2: Vercel

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel
```

### Option 3: Netlify

1. Drag and drop folder to Netlify
2. Or use Netlify CLI

## 🆘 Troubleshooting

### Students can't register

- Check Firestore security rules are deployed
- Verify Firebase config is correct
- Check browser console for errors

### Teacher can't log in

- Verify teacher account exists in Firebase Authentication
- Check email/password is correct
- Clear browser cache

### Zoom redirect not working

- Ensure Zoom links are properly configured
- Check links include `zoom.us` domain
- Verify links are complete with meeting ID and password

## 📈 Future Enhancements

- Email notifications for new registrations
- SMS reminders for classes
- QR code registration
- Multiple teacher accounts with roles
- Attendance tracking
- Student performance analytics
- Payment integration
- Bulk import/export

## 📞 Support

For technical support or questions:
- Check browser console for errors
- Review Firebase Console logs
- Verify network connectivity

## 📄 License

This project is created for educational purposes.

---

Built with ❤️ using Firebase, Bootstrap, and modern web technologies

**Version**: 1.0.0  
**Last Updated**: October 2025
