package tech.makanlab.musicplayer;

import android.os.Bundle;

import androidx.activity.OnBackPressedCallback;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MakanMediaPlugin.class);
        super.onCreate(savedInstanceState);
        // answers /api/stream and /api/artwork like the Windows app's own server does
        if (getBridge() != null) {
            getBridge().setWebViewClient(new MakanWebViewClient(getBridge(), this));
        }
        // Back button: first let the player go back one step (close a window, back to the song list);
        // at the song list, send the app to the background so the music keeps playing.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() == null || getBridge().getWebView() == null) { moveTaskToBack(true); return; }
                getBridge().getWebView().evaluateJavascript(
                    "(function(){try{return !!(window.MakanMobile&&window.MakanMobile.back&&window.MakanMobile.back());}catch(e){return false;}})()",
                    value -> { if (!"true".equals(value)) moveTaskToBack(true); });
            }
        });
    }
}
