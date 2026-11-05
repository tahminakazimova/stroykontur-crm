# Object photograph security verification

Executed: 2026-11-05T19:13:27.620Z

9 checks passed against real Supabase Storage, using only the publishable key and ordinary user sessions. No administrator key was used.

- ✅ Manager uploads an image before saving its object
- ✅ Manager can read private object photo
- ✅ Executor without assignments and anonymous user cannot read photo
- ✅ Private bucket cannot be accessed through a public URL
- ✅ Assigned executor can read photo; second executor cannot
- ✅ Executor cannot upload, overwrite or delete photos
- ✅ Server rejects unsupported MIME type and images over 5 MB
- ✅ Object cannot reference another object folder or more than ten photos
- ✅ Removing a photo reference prevents new signed download URLs
