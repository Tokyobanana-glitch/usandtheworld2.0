// Client-side downscale for passport photo uploads — a phone camera photo
// is routinely 5-10MB, which would blow through Storage quota fast and make
// every passport entry slow to load. Resizes so the long edge is at most
// maxLongEdge and re-encodes as JPEG before it ever reaches the network.
// No upload UI calls this yet (Passport has no UI in this pass — see
// api/claim-trips.js and the migration SQL for the rest of this
// foundation), but the upload path this feeds is already decided: Storage
// bucket "passport-photos", object path "<user id>/<filename>" (see
// supabase/004_auth_bucket_passport.sql's storage.objects RLS policies).
const DEFAULT_MAX_LONG_EDGE = 2000
const DEFAULT_QUALITY = 0.85

export async function downscaleImage(file, { maxLongEdge = DEFAULT_MAX_LONG_EDGE, quality = DEFAULT_QUALITY } = {}) {
  if (!file.type.startsWith('image/')) {
    throw new Error(`downscaleImage: expected an image file, got "${file.type || 'unknown type'}"`)
  }

  // imageOrientation: 'from-image' applies the file's own EXIF rotation
  // before we ever touch pixels — without it, a portrait phone photo can
  // come out sideways once the EXIF tag is dropped by the JPEG re-encode
  // below.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

  try {
    const longEdge = Math.max(bitmap.width, bitmap.height)
    const scale = longEdge > maxLongEdge ? maxLongEdge / longEdge : 1
    const targetWidth = Math.max(1, Math.round(bitmap.width * scale))
    const targetHeight = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0, targetWidth, targetHeight)

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((result) => (result ? resolve(result) : reject(new Error('Failed to encode downscaled image'))), 'image/jpeg', quality)
    })

    return new File([blob], jpegFileName(file.name), { type: 'image/jpeg' })
  } finally {
    bitmap.close()
  }
}

function jpegFileName(originalName) {
  const withoutExt = originalName.replace(/\.[^./\\]+$/, '')
  return `${withoutExt || 'photo'}.jpg`
}
