# 🚀 Complete Setup Guide

## Step-by-Step Instructions

### ✅ Step 1: Firebase Security Rules

Your Firebase is already configured, but you need to deploy the security rules:

1. Open Firebase Console: https://console.firebase.google.com
2. Select your project: **online-tutoring-6d71a**
3. Go to **Firestore Database** → **Rules** tab
4. Replace existing rules with the content from `firestore.rules` file
5. Click **Publish**

**Why?** This ensures students can register and teachers can manage data securely.

---

### ✅ Step 2: Create Teacher Account

1. In Firebase Console, go to **Authentication**
2. Click **Users** tab
3. Click **Add User**
4. Enter:
   - Email: `teacher@yourschool.com` (or your preferred email)
   - Password: Create a strong password
5. Click **Add User**

**Save these credentials** - you'll need them to log in to the dashboard!

---

### ✅ Step 3: Test Locally

#### Option A: Using Python (Easiest)

```bash
# Navigate to project folder
cd "C:\Users\USER\Desktop\SCHOOL PROJECTS\online-tutoring"

# Start server
python -m http.server 8000
```

Then open: http://localhost:8000

#### Option B: Using Node.js

```bash
# Install http-server globally
npm install -g http-server

# Navigate to project folder
cd "C:\Users\USER\Desktop\SCHOOL PROJECTS\online-tutoring"

# Start server
http-server
```

#### Option C: Using VS Code Live Server

1. Install "Live Server" extension in VS Code
2. Right-click `index.html`
3. Select "Open with Live Server"

---

### ✅ Step 4: Initial Configuration

1. **Access Dashboard**
   - Open http://localhost:8000/dashboard.html
   - Log in with teacher credentials you created

2. **Add Zoom Links**
   - Generate Zoom meeting links for morning and evening
   - Paste them in the dashboard
   - Click "Add Link" for each

3. **Test Registration**
   - Open http://localhost:8000/morning.html
   - Select a country (e.g., Kenya)
   - Enter a test phone number
   - Complete registration
   - Verify redirect to Zoom works

4. **Verify Dashboard**
   - Return to dashboard
   - Check if student appears in morning session list
   - Try deleting the test student
   - Try exporting to CSV

---

### ✅ Step 5: Share with Students

Once everything works:

1. **Copy Registration Links from Dashboard:**
   - Morning: `http://localhost:8000/morning.html`
   - Evening: `http://localhost:8000/evening.html`

2. **Share Links:**
   - Via WhatsApp groups
   - Email
   - SMS
   - Printed handouts

3. **Instruct Students:**
   ```
   To join online classes:
   1. Click the registration link
   2. Select your country
   3. Enter your parent's phone number
   4. Complete the form (first time only)
   5. You'll be redirected to Zoom
   ```

---

## 🌐 Deployment to Public Web

### Option 1: Firebase Hosting (Recommended)

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login to Firebase
firebase login

# Initialize hosting
firebase init hosting
# Select your project: online-tutoring-6d71a
# Public directory: . (current directory)
# Configure as single-page app: No
# Set up automatic builds: No
# Don't overwrite existing files

# Deploy
firebase deploy --only hosting
```

Your site will be live at: `https://online-tutoring-6d71a.web.app`

### Option 2: Vercel (Fast & Free)

```bash
# Install Vercel CLI
npm install -g vercel

# Deploy
vercel

# Follow prompts
# Your site will be live instantly!
```

### Option 3: Netlify (Drag & Drop)

1. Go to https://app.netlify.com
2. Drag and drop your project folder
3. Site is live in seconds!

---

## 📱 Getting Zoom Links

### For Teachers:

1. **Log in to Zoom** (https://zoom.us)

2. **Schedule a Meeting:**
   - Click "Schedule a Meeting"
   - Set it as recurring (no fixed time)
   - Enable waiting room (recommended)
   - Save

3. **Copy Meeting Link:**
   - Click "Copy Invitation"
   - Extract the join URL
   - Example: `https://zoom.us/j/123456789?pwd=abc123`

4. **Create Two Meetings:**
   - One for morning session
   - One for evening session
   - (Or use same link for both)

5. **Paste in Dashboard:**
   - Open teacher dashboard
   - Paste links in respective fields
   - Click "Add Link"

---

## 🔧 Troubleshooting

### Problem: "Permission Denied" when student registers

**Solution:**
- Deploy Firestore security rules from `firestore.rules`
- Go to Firebase Console → Firestore → Rules
- Publish the new rules

### Problem: Teacher can't log in

**Solution:**
- Verify teacher account exists in Firebase Authentication
- Check email/password
- Clear browser cache
- Try incognito mode

### Problem: Students not appearing in dashboard

**Solution:**
- Refresh the dashboard page
- Check Firebase Console → Firestore → sessions collection
- Verify data is being saved

### Problem: Zoom redirect not working

**Solution:**
- Ensure Zoom link includes `zoom.us` domain
- Check link is complete with meeting ID
- Test the Zoom link directly in browser

### Problem: Phone validation failing

**Solution:**
- Ensure country is selected first
- Enter phone without country code (just the number)
- Check number matches selected country's format

---

## 📊 Understanding the System

### Database Structure

```
Firestore:
  ├── config/
  │   └── zoomLinks/
  │       ├── morning: "zoom link"
  │       ├── evening: "zoom link"
  │       └── timestamps
  │
  └── sessions/
      ├── morning/
      │   └── +254712345678/
      │       ├── studentName: "John Doe"
      │       ├── class: "Form Two"
      │       ├── subjects: "Math, Physics"
      │       ├── receiptMessage: "Payment details"
      │       └── timestamps
      │
      └── evening/
          └── +254723456789/
              └── [same structure]
```

### Phone Number Storage

- Stored with full international format
- Example: `+254712345678` (Kenya)
- Example: `+1234567890` (USA)
- Used as unique identifier per session

### Student Flow

```
New Student:
1. Select country → 2. Enter phone → 3. Fill form → 4. Submit → 5. Zoom redirect

Returning Student:
1. Select country → 2. Enter phone → 3. Welcome screen → 4. Auto-redirect (3sec)
```

---

## 🎯 Best Practices

### For Teachers:

1. **Daily Routine:**
   - Check dashboard before classes
   - Verify new registrations
   - Remove unverified students
   - Export CSV for records

2. **Payment Verification:**
   - Check receipt details in dashboard
   - Mark verified payments in external spreadsheet
   - Delete students with invalid payments

3. **Communication:**
   - Share registration links in advance
   - Remind students to register early
   - Have backup Zoom link ready

### For Students:

1. **Registration:**
   - Keep parent's phone number handy
   - Complete form accurately
   - Save confirmation screenshot

2. **Joining Classes:**
   - Click the same link each day
   - System recognizes you automatically
   - No need to re-register

---

## 📈 Monitoring & Analytics

### Check These Regularly:

1. **Total Registrations:**
   - Morning session count
   - Evening session count
   - Total unique students

2. **Recent Registrations:**
   - Check timestamps
   - Verify payment details
   - Follow up on incomplete info

3. **System Health:**
   - Zoom links working
   - Firebase connection stable
   - No error messages

---

## 🆘 Getting Help

### Self-Help Resources:

1. **Browser Console:**
   - Press F12
   - Check Console tab for errors
   - Take screenshot if errors appear

2. **Firebase Console:**
   - Check Firestore for data
   - Review Authentication logs
   - Monitor usage quotas

3. **Test Everything:**
   - Use different phones/devices
   - Try different countries
   - Test both sessions

### Common Error Messages:

| Error | Solution |
|-------|----------|
| "Permission denied" | Deploy security rules |
| "Invalid phone" | Select country first |
| "Auth failed" | Check teacher credentials |
| "Network error" | Check internet connection |

---

## ✅ Final Checklist

Before going live:

- [ ] Firestore security rules deployed
- [ ] Teacher account created and tested
- [ ] Both Zoom links added and working
- [ ] Test registration completed successfully
- [ ] Dashboard shows test student
- [ ] Delete function works
- [ ] CSV export works
- [ ] Mobile responsive (test on phone)
- [ ] Different countries tested
- [ ] Returning student flow tested

Once all checked, you're ready to share with students! 🎉

---

## 📞 Technical Support

If you encounter issues:

1. Check this guide first
2. Review browser console errors
3. Check Firebase Console logs
4. Test in incognito mode
5. Try different browser

**Remember:** The system is designed to work flawlessly with minimal intervention. Most issues are configuration-related and easily fixed!

---

**Good luck with your online tutoring! 🎓📚**
