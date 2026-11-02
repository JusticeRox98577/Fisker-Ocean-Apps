package com.justicemw.ocean_live;

import io.flutter.embedding.android.FlutterActivity;
import io.flutter.embedding.engine.FlutterEngine;
import android.content.Context;

public class MainActivity extends FlutterActivity {
    @Override public FlutterEngine provideFlutterEngine(Context context) {
        return ((OceanApplication)getApplication()).engine;
    }
    @Override public boolean shouldDestroyEngineWithHost() { return false; }
    @Override protected void onResume() { super.onResume(); ((OceanApplication)getApplication()).activity = this; }
    @Override protected void onPause() { ((OceanApplication)getApplication()).activity = null; super.onPause(); }
}
