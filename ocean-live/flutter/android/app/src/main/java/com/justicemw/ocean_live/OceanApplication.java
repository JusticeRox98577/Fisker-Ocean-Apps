package com.justicemw.ocean_live;

import android.app.Application;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONObject;
import io.flutter.embedding.engine.FlutterEngine;
import io.flutter.embedding.engine.FlutterEngineCache;
import io.flutter.embedding.engine.dart.DartExecutor;
import io.flutter.plugin.common.MethodChannel;

/** Platform lifecycle and display bridge only. All vehicle/account logic lives in Dart. */
public class OceanApplication extends Application {
    public FlutterEngine engine;
    public MethodChannel channel;
    public MainActivity activity;
    @Override public void onCreate() {
        super.onCreate();
        engine = new FlutterEngine(this);
        channel = new MethodChannel(engine.getDartExecutor().getBinaryMessenger(), "ocean_live/platform");
        channel.setMethodCallHandler((call, result) -> {
            try {
                switch (call.method) {
                    case "legacySettings": {
                        Map<String,Object> legacy = new HashMap<>(getSharedPreferences("ocean", MODE_PRIVATE).getAll());
                        String history = getSharedPreferences("ocean_history", MODE_PRIVATE).getString("historyEntries", null);
                        if (history != null) legacy.put("historyEntries", history);
                        result.success(legacy); break;
                    }
                    case "finishMigration": {
                        SharedPreferences.Editor edit = getSharedPreferences("ocean", MODE_PRIVATE).edit();
                        for (String key : new String[]{"apiKey","token","fiskerBearer","fiskerEmail","fiskerFleet","fiskerToken","fiskerVin","fiskerRefreshToken"}) edit.remove(key);
                        edit.apply(); result.success(null); break;
                    }
                    case "snapshot": {
                        Map<?,?> snapshot = (Map<?,?>) call.arguments;
                        getSharedPreferences("ocean_flutter_display", MODE_PRIVATE).edit().putString("snapshot", new JSONObject(snapshot).toString()).apply();
                        OceanWidget.refresh(this); result.success(null); break;
                    }
                    case "startBackground": {
                        Intent intent = new Intent(this, OceanForegroundService.class);
                        startForegroundService(intent); result.success(null); break;
                    }
                    case "stopBackground": stopService(new Intent(this, OceanForegroundService.class)); result.success(null); break;
                    case "keepScreenOn": {
                        if (activity != null) {
                            if (Boolean.TRUE.equals(call.arguments)) activity.getWindow().addFlags(128);
                            else activity.getWindow().clearFlags(128);
                        }
                        result.success(null); break;
                    }
                    case "notify": {
                        Map<?,?> args = (Map<?,?>) call.arguments;
                        NotificationManager manager = getSystemService(NotificationManager.class);
                        manager.createNotificationChannel(new NotificationChannel("ocean_alerts", "Charge alerts", NotificationManager.IMPORTANCE_HIGH));
                        Notification notice = new Notification.Builder(this,"ocean_alerts")
                            .setSmallIcon(com.justicemw.ocean_live.R.drawable.ic_notif)
                            .setContentTitle(String.valueOf(args.get("title"))).setContentText(String.valueOf(args.get("body")))
                            .setContentIntent(PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT))
                            .setAutoCancel(true).build();
                        try { manager.notify(((Number)args.get("id")).intValue(), notice); } catch (SecurityException ignored) { }
                        result.success(null); break;
                    }
                    default: result.notImplemented();
                }
            } catch (Exception ignored) { result.error("platform", "Platform integration unavailable", null); }
        });
        FlutterEngineCache.getInstance().put("ocean", engine);
        engine.getDartExecutor().executeDartEntrypoint(DartExecutor.DartEntrypoint.createDefault());
    }
}
