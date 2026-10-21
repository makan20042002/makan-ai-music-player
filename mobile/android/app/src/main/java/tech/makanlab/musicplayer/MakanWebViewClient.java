package tech.makanlab.musicplayer;

import android.content.ContentResolver;
import android.content.Context;
import android.content.res.AssetFileDescriptor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.util.LruCache;
import android.util.Size;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Answers the same web addresses the Windows app's local server answers, so the player's own code does not change:
 *   /api/stream?id=...   the song (supports "Range", so seeking works)
 *   /api/artwork?id=...  the cover picture
 * Everything else goes to the normal Capacitor handler.
 */
public class MakanWebViewClient extends BridgeWebViewClient {
    /** song id -> content:// address. Filled by MakanMediaPlugin.registerTracks. */
    static final Map<String, String> URIS = new ConcurrentHashMap<>();

    private final Context ctx;
    private final LruCache<String, byte[]> artCache = new LruCache<String, byte[]>(6 * 1024 * 1024) {
        @Override protected int sizeOf(String k, byte[] v) { return v.length; }
    };

    public MakanWebViewClient(Bridge bridge, Context context) {
        super(bridge);
        this.ctx = context.getApplicationContext();
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        try {
            String path = request.getUrl().getPath();
            if ("/api/stream".equals(path)) return stream(request);
            if ("/api/artwork".equals(path)) return artwork(request);
        } catch (Throwable t) {
            return notFound();
        }
        return super.shouldInterceptRequest(view, request);
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
    }

    private Uri uriFor(WebResourceRequest request) {
        String id = request.getUrl().getQueryParameter("id");
        String s = id == null ? null : URIS.get(id);
        if (s != null) return Uri.parse(s);
        // After the app is closed and opened again the address table is empty until the first scan has run, but the
        // player already asks for the last song. Song ids are "ms-<MediaStore id>", so the address can be rebuilt.
        if (id != null && id.matches("ms-[0-9]{1,18}")) {
            try {
                return android.content.ContentUris.withAppendedId(android.provider.MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, Long.parseLong(id.substring(3)));
            } catch (Throwable t) { return null; }
        }
        return null;
    }

    // ---- song, with Range
    private WebResourceResponse stream(WebResourceRequest request) throws IOException {
        Uri uri = uriFor(request);
        if (uri == null) return notFound();
        ContentResolver cr = ctx.getContentResolver();
        AssetFileDescriptor afd = cr.openAssetFileDescriptor(uri, "r");
        if (afd == null) return notFound();
        long total = afd.getLength();
        if (total < 0) total = afd.getParcelFileDescriptor().getStatSize();
        String mime = cr.getType(uri);
        if (mime == null || mime.length() == 0) mime = "audio/mpeg";

        long start = 0, end = total - 1;
        boolean partial = false;
        String range = request.getRequestHeaders().get("Range");
        if (range == null) range = request.getRequestHeaders().get("range");
        if (range != null && range.startsWith("bytes=") && total > 0) {
            String[] p = range.substring(6).split("-", 2);
            try {
                if (p[0].length() > 0) start = Long.parseLong(p[0].trim());
                if (p.length > 1 && p[1].trim().length() > 0) end = Long.parseLong(p[1].trim());
                else end = total - 1;
                if (p[0].length() == 0 && p.length > 1) { // "bytes=-N" = last N bytes
                    long n = Long.parseLong(p[1].trim());
                    start = Math.max(0, total - n);
                    end = total - 1;
                }
                if (start < 0 || start >= total) start = 0;
                if (end >= total) end = total - 1;
                partial = true;
            } catch (NumberFormatException e) { start = 0; end = total - 1; partial = false; }
        }
        long length = end - start + 1;

        FileInputStream fis = afd.createInputStream();
        fis.getChannel().position(afd.getStartOffset() + start);
        InputStream body = new LimitedStream(fis, length);

        Map<String, String> h = new HashMap<>();
        h.put("Accept-Ranges", "bytes");
        h.put("Content-Length", String.valueOf(length));
        h.put("Cache-Control", "no-cache");
        h.put("Access-Control-Allow-Origin", "*");
        if (partial) h.put("Content-Range", "bytes " + start + "-" + end + "/" + total);
        return new WebResourceResponse(mime, null, partial ? 206 : 200, partial ? "Partial Content" : "OK", h, body);
    }

    private static class LimitedStream extends InputStream {
        private final InputStream in; private long left;
        LimitedStream(InputStream in, long left) { this.in = in; this.left = left; }
        @Override public int read() throws IOException {
            if (left <= 0) return -1;
            int b = in.read(); if (b >= 0) left--; return b;
        }
        @Override public int read(byte[] b, int off, int len) throws IOException {
            if (left <= 0) return -1;
            int n = in.read(b, off, (int) Math.min(len, left));
            if (n > 0) left -= n; return n;
        }
        @Override public int available() { return (int) Math.min(left, Integer.MAX_VALUE); }
        @Override public void close() throws IOException { in.close(); }
    }

    // ---- cover picture
    private WebResourceResponse artwork(WebResourceRequest request) {
        String id = request.getUrl().getQueryParameter("id");
        Uri uri = uriFor(request);
        if (id == null || uri == null) return notFound();
        byte[] jpg = artCache.get(id);
        if (jpg == null) {
            jpg = loadArt(uri);
            if (jpg == null) return notFound();
            artCache.put(id, jpg);
        }
        Map<String, String> h = new HashMap<>();
        h.put("Cache-Control", "no-cache");
        h.put("Access-Control-Allow-Origin", "*");
        return new WebResourceResponse("image/jpeg", null, 200, "OK", h, new ByteArrayInputStream(jpg));
    }

    /** Picture of a song as a JPEG (max 512 px), or null if the song has none. Also used by the notification. */
    static byte[] loadArt(Context ctx, Uri uri) {
        Bitmap bmp = null;
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                bmp = ctx.getContentResolver().loadThumbnail(uri, new Size(512, 512), null);
            }
        } catch (Throwable ignored) { bmp = null; }
        if (bmp == null) {
            MediaMetadataRetriever r = new MediaMetadataRetriever();
            try {
                r.setDataSource(ctx, uri);
                byte[] pic = r.getEmbeddedPicture();
                if (pic != null) {
                    BitmapFactory.Options o = new BitmapFactory.Options();
                    o.inJustDecodeBounds = true;
                    BitmapFactory.decodeByteArray(pic, 0, pic.length, o);
                    int sample = 1;
                    while (o.outWidth / sample > 1024) sample *= 2;
                    BitmapFactory.Options o2 = new BitmapFactory.Options();
                    o2.inSampleSize = sample;
                    bmp = BitmapFactory.decodeByteArray(pic, 0, pic.length, o2);
                }
            } catch (Throwable ignored) {
                bmp = null;
            } finally {
                try { r.release(); } catch (Throwable ignored) { }
            }
        }
        if (bmp == null) return null;
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        bmp.compress(Bitmap.CompressFormat.JPEG, 86, out);
        return out.toByteArray();
    }

    private byte[] loadArt(Uri uri) { return loadArt(ctx, uri); }
}
