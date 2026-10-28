Rico's Integrated Home Utilities – Smart Solutions v1.3.0

UPLOAD ALL SIX FILES into the same GitHub Pages repository directory:
- index.html
- sw.js                    (required for offline first launch after installation)
- manifest.webmanifest
- apple-touch-icon.png
- home-utilities-icon-192.png
- home-utilities-icon-512.png

ONE-TIME SETUP
1. BACK UP your existing app records in Backup > Download JSON Backup.
2. Upload all six files to the SAME directory in your existing GitHub repo.
3. Open the published HTTPS site once WHILE ONLINE.
4. Go to Backup > Offline Access. Wait for "Offline Ready"; if needed tap "Save for Offline Use".
5. On iPhone, add this same website to Home Screen using Safari > Share > Add to Home Screen (if not installed yet).
6. Turn on Airplane Mode, close and reopen the Home Screen app to test offline launch.

TECHNICAL LIMIT: A GitHub Pages app CANNOT launch for the very first time
with no internet if it has NEVER been downloaded or installed onto that device.
The one-time online visit and successful offline caching are required.

New releases can still be installed using Backup > Check Updates when online.
The app continues to store records only in browser localStorage using the original
key rico-utility-monitor-v1. Update does not clear those records. Avoid clearing
Safari website data. Keep periodic JSON backups in a separate location.

OFFLINE VERSION v1.3.0 adds auto-installed service worker, install manifest,
network-first HTML with cached offline fallback, offline status and manual
preparation button. All v1.2.2 features are retained.
