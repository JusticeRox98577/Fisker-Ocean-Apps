package com.justicemw.ocean_live.pkc;

import android.content.Context;
import com.justicemw.ocean_live.BuildConfig;
import io.flutter.plugin.common.BinaryMessenger;
import io.flutter.plugin.common.EventChannel;
import io.flutter.plugin.common.MethodChannel;
import java.util.HashMap;
import java.util.Map;

/**
 * Bridges PkcKeyManager (BLE peripheral/GATT-server phone-as-key) to Dart.
 *
 * This is the one place native code carries real vehicle-command logic in
 * this app - everything else stays "platform lifecycle and display bridge
 * only" per OceanApplication's own comment, but Android's BLE peripheral and
 * GATT-server APIs have no Flutter-side equivalent, so this can't move to
 * Dart. It's inert unless OCEAN_DEV is true (dev flavor), matching
 * AppConfig.devBuild on the Dart side, so the public app never touches
 * Bluetooth for this at all.
 */
public final class PkcPlugin implements PkcKeyManager.Listener {
    private final PkcKeyManager manager;
    private final EventChannel.EventSink[] eventSink = new EventChannel.EventSink[1];

    public PkcPlugin(Context context, BinaryMessenger messenger) {
        this.manager = new PkcKeyManager(context, this);

        MethodChannel methodChannel = new MethodChannel(messenger, "ocean_live/pkc");
        methodChannel.setMethodCallHandler((call, result) -> {
            if (!BuildConfig.OCEAN_DEV) {
                result.error("not_dev_build", "PKC is dev-build only", null);
                return;
            }
            try {
                switch (call.method) {
                    case "connect": {
                        String vaKey = (String) call.argument("vaKey");
                        manager.connect(vaKey);
                        result.success(null);
                        break;
                    }
                    case "lock": manager.lock(); result.success(null); break;
                    case "unlock": manager.unlock(); result.success(null); break;
                    case "disconnect": manager.disconnect(); result.success(null); break;
                    default: result.notImplemented();
                }
            } catch (IllegalArgumentException | IllegalStateException e) {
                result.error("pkc", e.getMessage(), null);
            }
        });

        EventChannel eventChannel = new EventChannel(messenger, "ocean_live/pkc/events");
        eventChannel.setStreamHandler(new EventChannel.StreamHandler() {
            @Override public void onListen(Object args, EventChannel.EventSink sink) { eventSink[0] = sink; }
            @Override public void onCancel(Object args) { eventSink[0] = null; }
        });
    }

    @Override
    public void onStatus(String status) {
        if (eventSink[0] != null) {
            Map<String, Object> event = new HashMap<>();
            event.put("type", "status");
            event.put("value", status);
            eventSink[0].success(event);
        }
    }

    @Override
    public void onCommandAck(String command, boolean ok) {
        if (eventSink[0] != null) {
            Map<String, Object> event = new HashMap<>();
            event.put("type", "ack");
            event.put("command", command);
            event.put("ok", ok);
            eventSink[0].success(event);
        }
    }
}
