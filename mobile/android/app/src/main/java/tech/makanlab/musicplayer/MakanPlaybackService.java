package tech.makanlab.musicplayer;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps the music playing with the screen off and shows the notification / lock-screen player.
 * The sound itself is still played by the web page; this service only keeps the app alive and
 * shows the controls. Button presses are handed to the web page through MakanMediaPlugin.
 */
public class MakanPlaybackService extends Service {
    public interface Listener { void onAction(String action, double seconds); }

    static final String ACTION_UPDATE = "tech.makanlab.musicplayer.UPDATE";
    static final String ACTION_PLAY = "tech.makanlab.musicplayer.PLAY";
    static final String ACTION_PAUSE = "tech.makanlab.musicplayer.PAUSE";
    static final String ACTION_NEXT = "tech.makanlab.musicplayer.NEXT";
    static final String ACTION_PREV = "tech.makanlab.musicplayer.PREV";
    static final String ACTION_STOP = "tech.makanlab.musicplayer.STOP";
    private static final String CHANNEL = "makan_playback";
    private static final int NOTIF_ID = 4711;

    static MakanPlaybackService instance;
    static Listener listener;

    private MediaSession session;
    private NotificationManager nm;
    private PowerManager.WakeLock wake;
    private String title = "", artist = "", album = "", uriStr = "", artForUri = "";
    private boolean playing = false;
    private double position = 0, duration = 0;
    private Bitmap art;
    private boolean foreground = false;

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Music playback", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        session = new MediaSession(this, "MAKAN Music Player");
        session.setCallback(new MediaSession.Callback() {
            @Override public void onPlay() { send("play", 0); }
            @Override public void onPause() { send("pause", 0); }
            @Override public void onSkipToNext() { send("next", 0); }
            @Override public void onSkipToPrevious() { send("prev", 0); }
            @Override public void onStop() { send("stop", 0); }
            @Override public void onSeekTo(long pos) { send("seek", pos / 1000.0); }
        });
        session.setFlags(MediaSession.FLAG_HANDLES_MEDIA_BUTTONS | MediaSession.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setActive(true);
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "makan:playback");
            wake.setReferenceCounted(false);
        }
    }

    private void send(String action, double seconds) {
        Listener l = listener;
        if (l != null) l.onAction(action, seconds);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null) {
            String a = intent.getAction();
            if (ACTION_UPDATE.equals(a)) apply(intent);
            else if (ACTION_PLAY.equals(a)) send("play", 0);
            else if (ACTION_PAUSE.equals(a)) send("pause", 0);
            else if (ACTION_NEXT.equals(a)) send("next", 0);
            else if (ACTION_PREV.equals(a)) send("prev", 0);
            else if (ACTION_STOP.equals(a)) send("stop", 0);
        }
        // Android requires startForeground soon after startForegroundService
        if (!foreground) showNotification();
        return START_NOT_STICKY;
    }

    void apply(Intent i) {
        title = nz(i.getStringExtra("title"));
        artist = nz(i.getStringExtra("artist"));
        album = nz(i.getStringExtra("album"));
        String u = nz(i.getStringExtra("uri"));
        playing = i.getBooleanExtra("playing", false);
        position = i.getDoubleExtra("position", 0);
        duration = i.getDoubleExtra("duration", 0);
        if (!u.equals(artForUri)) {
            artForUri = u;
            art = null;
            if (u.length() > 0) {
                try {
                    byte[] jpg = MakanWebViewClient.loadArt(this, Uri.parse(u));
                    if (jpg != null) art = BitmapFactory.decodeByteArray(jpg, 0, jpg.length);
                } catch (Throwable ignored) { art = null; }
            }
        }
        if (wake != null) {
            try { if (playing && !wake.isHeld()) wake.acquire(6 * 60 * 60 * 1000L); else if (!playing && wake.isHeld()) wake.release(); } catch (Throwable ignored) { }
        }
        showNotification();
    }

    private static String nz(String s) { return s == null ? "" : s; }

    private PendingIntent act(String action, int code) {
        Intent i = new Intent(this, MakanPlaybackService.class);
        i.setAction(action);
        int f = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        return Build.VERSION.SDK_INT >= 26 ? PendingIntent.getForegroundService(this, code, i, f) : PendingIntent.getService(this, code, i, f);
    }

    private void showNotification() {
        MediaMetadata.Builder mb = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, (long) (duration * 1000));
        if (art != null) mb.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, art);
        session.setMetadata(mb.build());
        long actions = PlaybackState.ACTION_PLAY | PlaybackState.ACTION_PAUSE | PlaybackState.ACTION_PLAY_PAUSE
            | PlaybackState.ACTION_SKIP_TO_NEXT | PlaybackState.ACTION_SKIP_TO_PREVIOUS | PlaybackState.ACTION_SEEK_TO | PlaybackState.ACTION_STOP;
        session.setPlaybackState(new PlaybackState.Builder()
            .setActions(actions)
            .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, (long) (position * 1000), playing ? 1f : 0f)
            .build());

        Notification.Builder nb = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CHANNEL) : new Notification.Builder(this);
        nb.setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle(title.length() > 0 ? title : "MAKAN Music Player")
            .setContentText(artist)
            .setSubText(album)
            .setOngoing(playing)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC);
        if (art != null) nb.setLargeIcon(art);
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open != null) {
            nb.setContentIntent(PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0)));
        }
        nb.addAction(new Notification.Action.Builder(android.R.drawable.ic_media_previous, "Previous", act(ACTION_PREV, 1)).build());
        if (playing) nb.addAction(new Notification.Action.Builder(android.R.drawable.ic_media_pause, "Pause", act(ACTION_PAUSE, 2)).build());
        else nb.addAction(new Notification.Action.Builder(android.R.drawable.ic_media_play, "Play", act(ACTION_PLAY, 3)).build());
        nb.addAction(new Notification.Action.Builder(android.R.drawable.ic_media_next, "Next", act(ACTION_NEXT, 4)).build());
        nb.setStyle(new Notification.MediaStyle().setMediaSession(session.getSessionToken()).setShowActionsInCompactView(0, 1, 2));
        Notification n = nb.build();

        if (playing || !foreground) {
            try {
                if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
                else startForeground(NOTIF_ID, n);
                foreground = true;
            } catch (Throwable t) {
                try { nm.notify(NOTIF_ID, n); } catch (Throwable ignored) { }
            }
        } else {
            // paused: leave foreground mode but keep the notification so it can be resumed or swiped away
            stopForeground(false);
            foreground = false;
            try { nm.notify(NOTIF_ID, n); } catch (Throwable ignored) { }
        }
    }

    void shutdown() {
        try { stopForeground(true); } catch (Throwable ignored) { }
        foreground = false;
        try { nm.cancel(NOTIF_ID); } catch (Throwable ignored) { }
        stopSelf();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // the player page lives inside the app window; when the app is swiped away the sound stops, so the controls go too
        shutdown();
        super.onTaskRemoved(rootIntent);
    }

    @Override
    public void onDestroy() {
        if (wake != null && wake.isHeld()) { try { wake.release(); } catch (Throwable ignored) { } }
        try { session.setActive(false); session.release(); } catch (Throwable ignored) { }
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
