package tech.makanlab.musicplayer;

import android.Manifest;
import android.content.ContentUris;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.util.Locale;

/**
 * Phone side of the player. JavaScript name: "MakanMedia".
 *  requestAudio      ask for permission to read music
 *  scan              list the music on the phone (Android's media library)
 *  registerTracks    tell the web server which song id is which file
 *  storeRead/Write   keep the library database and settings as files in the app's private folder
 *  nowPlaying        update the notification / lock screen (and keep playing in the background)
 *  stopNowPlaying    remove the notification
 * Event "mediaAction" is sent to JavaScript when a notification / headset / lock-screen button is pressed.
 */
@CapacitorPlugin(
    name = "MakanMedia",
    permissions = {
        @Permission(strings = { Manifest.permission.READ_MEDIA_AUDIO }, alias = "audio33"),
        @Permission(strings = { Manifest.permission.READ_EXTERNAL_STORAGE }, alias = "audioOld"),
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notif")
    }
)
public class MakanMediaPlugin extends Plugin implements MakanPlaybackService.Listener {

    @Override
    public void load() {
        MakanPlaybackService.listener = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (MakanPlaybackService.listener == this) MakanPlaybackService.listener = null;
    }

    @Override
    public void onAction(String action, double seconds) {
        JSObject o = new JSObject();
        o.put("action", action);
        o.put("seconds", seconds);
        notifyListeners("mediaAction", o, true);
    }

    private String audioAlias() { return Build.VERSION.SDK_INT >= 33 ? "audio33" : "audioOld"; }

    // ---------- permission
    @PluginMethod
    public void requestAudio(PluginCall call) {
        if (getPermissionState(audioAlias()) == PermissionState.GRANTED) {
            JSObject o = new JSObject(); o.put("granted", true); call.resolve(o);
            return;
        }
        requestPermissionForAlias(audioAlias(), call, "audioDone");
    }

    @PermissionCallback
    private void audioDone(PluginCall call) {
        JSObject o = new JSObject();
        o.put("granted", getPermissionState(audioAlias()) == PermissionState.GRANTED);
        call.resolve(o);
    }

    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notif") == PermissionState.GRANTED) {
            JSObject o = new JSObject(); o.put("granted", true); call.resolve(o);
            return;
        }
        requestPermissionForAlias("notif", call, "notifDone");
    }

    @PermissionCallback
    private void notifDone(PluginCall call) {
        JSObject o = new JSObject();
        o.put("granted", Build.VERSION.SDK_INT < 33 || getPermissionState("notif") == PermissionState.GRANTED);
        call.resolve(o);
    }

    // ---------- scan
    @PluginMethod
    public void scan(final PluginCall call) {
        if (getPermissionState(audioAlias()) != PermissionState.GRANTED) {
            call.reject("permission");
            return;
        }
        new Thread(new Runnable() {
            @Override public void run() {
                try {
                    call.resolve(doScan());
                } catch (Throwable t) {
                    call.reject("scan-failed: " + t.getClass().getSimpleName());
                }
            }
        }).start();
    }

    private static String clean(String s) {
        if (s == null) return null;
        s = s.trim();
        if (s.length() == 0 || s.equals("<unknown>")) return null;
        return s;
    }

    private JSObject doScan() throws Exception {
        Context ctx = getContext();
        Uri collection = Build.VERSION.SDK_INT >= 29
            ? MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL)
            : MediaStore.Audio.Media.EXTERNAL_CONTENT_URI;
        java.util.ArrayList<String> cols = new java.util.ArrayList<>(java.util.Arrays.asList(
            MediaStore.Audio.Media._ID, MediaStore.Audio.Media.DATA, MediaStore.Audio.Media.DISPLAY_NAME,
            MediaStore.Audio.Media.TITLE, MediaStore.Audio.Media.ARTIST, MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.YEAR, MediaStore.Audio.Media.TRACK, MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.SIZE, MediaStore.Audio.Media.DATE_MODIFIED, MediaStore.Audio.Media.DATE_ADDED,
            MediaStore.Audio.Media.MIME_TYPE));
        boolean extra = Build.VERSION.SDK_INT >= 30;
        if (extra) { cols.add("genre"); cols.add("album_artist"); }
        String[] proj = cols.toArray(new String[0]);
        String sel = MediaStore.Audio.Media.IS_MUSIC + " != 0 AND " + MediaStore.Audio.Media.DURATION + " >= 5000";

        JSONArray list = new JSONArray();
        Cursor c = ctx.getContentResolver().query(collection, proj, sel, null, MediaStore.Audio.Media.TITLE + " COLLATE NOCASE ASC");
        if (c != null) {
            try {
                int iId = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                int iData = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATA);
                int iName = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME);
                int iTitle = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
                int iArtist = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
                int iAlbum = c.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
                int iYear = c.getColumnIndexOrThrow(MediaStore.Audio.Media.YEAR);
                int iTrack = c.getColumnIndexOrThrow(MediaStore.Audio.Media.TRACK);
                int iDur = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
                int iSize = c.getColumnIndexOrThrow(MediaStore.Audio.Media.SIZE);
                int iMod = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_MODIFIED);
                int iAdd = c.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED);
                int iMime = c.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE);
                int iGenre = extra ? c.getColumnIndex("genre") : -1;
                int iAA = extra ? c.getColumnIndex("album_artist") : -1;
                while (c.moveToNext()) {
                    long id = c.getLong(iId);
                    Uri uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
                    JSONObject o = new JSONObject();
                    o.put("mediaId", id);
                    o.put("uri", uri.toString());
                    o.put("path", c.getString(iData));
                    o.put("name", c.getString(iName));
                    o.put("title", clean(c.getString(iTitle)));
                    o.put("artist", clean(c.getString(iArtist)));
                    o.put("album", clean(c.getString(iAlbum)));
                    int tr = c.getInt(iTrack);
                    o.put("trackNum", tr % 1000);
                    o.put("discNum", tr / 1000);
                    o.put("year", c.getInt(iYear));
                    o.put("duration", c.getLong(iDur) / 1000.0);
                    o.put("size", c.getLong(iSize));
                    o.put("modified", c.getLong(iMod));
                    o.put("added", c.getLong(iAdd));
                    o.put("mime", c.getString(iMime));
                    if (iGenre >= 0) o.put("genre", clean(c.getString(iGenre)));
                    if (iAA >= 0) o.put("albumArtist", clean(c.getString(iAA)));
                    list.put(o);
                }
            } finally {
                c.close();
            }
        }
        JSObject res = new JSObject();
        res.put("tracks", new JSArray(list.toString()));
        return res;
    }

    // ---------- id -> file, for /api/stream and /api/artwork
    @PluginMethod
    public void registerTracks(PluginCall call) {
        try {
            JSArray items = call.getArray("items");
            MakanWebViewClient.URIS.clear();
            for (int i = 0; i < items.length(); i++) {
                JSONObject o = items.getJSONObject(i);
                MakanWebViewClient.URIS.put(o.getString("id"), o.getString("uri"));
            }
            JSObject r = new JSObject(); r.put("count", items.length()); call.resolve(r);
        } catch (Exception e) {
            call.reject("bad-items");
        }
    }

    // ---------- private files (library database, settings, lyrics)
    private File storeFile(String name) {
        String safe = name == null ? "" : name.replaceAll("[^A-Za-z0-9._-]", "_");
        File dir = new File(getContext().getFilesDir(), "store");
        if (!dir.exists()) dir.mkdirs();
        return new File(dir, safe);
    }

    @PluginMethod
    public void storeRead(PluginCall call) {
        File f = storeFile(call.getString("name"));
        JSObject r = new JSObject();
        if (!f.exists()) { r.put("data", (String) null); call.resolve(r); return; }
        try {
            FileInputStream in = new FileInputStream(f);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[65536]; int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            in.close();
            r.put("data", Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            call.resolve(r);
        } catch (Exception e) {
            call.reject("read-failed");
        }
    }

    @PluginMethod
    public void storeWrite(PluginCall call) {
        String data = call.getString("data");
        if (data == null) { call.reject("no-data"); return; }
        File f = storeFile(call.getString("name"));
        File tmp = new File(f.getPath() + ".tmp");
        try {
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            FileOutputStream out = new FileOutputStream(tmp);
            out.write(bytes);
            out.getFD().sync();
            out.close();
            if (f.exists() && !f.delete()) { call.reject("replace-failed"); return; }
            if (!tmp.renameTo(f)) { call.reject("rename-failed"); return; }
            call.resolve();
        } catch (Exception e) {
            call.reject("write-failed");
        }
    }

    // ---------- notification / lock screen / background
    @PluginMethod
    public void nowPlaying(PluginCall call) {
        Context ctx = getContext();
        Intent i = new Intent(ctx, MakanPlaybackService.class);
        i.setAction(MakanPlaybackService.ACTION_UPDATE);
        i.putExtra("title", call.getString("title", ""));
        i.putExtra("artist", call.getString("artist", ""));
        i.putExtra("album", call.getString("album", ""));
        i.putExtra("uri", call.getString("uri", ""));
        i.putExtra("playing", Boolean.TRUE.equals(call.getBoolean("playing", false)));
        i.putExtra("position", call.getDouble("position", 0.0).doubleValue());
        i.putExtra("duration", call.getDouble("duration", 0.0).doubleValue());
        MakanPlaybackService svc = MakanPlaybackService.instance;
        if (svc != null) {
            svc.apply(i);
        } else if (Boolean.TRUE.equals(call.getBoolean("playing", false))) {
            try { ContextCompat.startForegroundService(ctx, i); } catch (Throwable ignored) { }
        }
        call.resolve();
    }

    @PluginMethod
    public void stopNowPlaying(PluginCall call) {
        MakanPlaybackService svc = MakanPlaybackService.instance;
        if (svc != null) svc.shutdown();
        call.resolve();
    }
}
