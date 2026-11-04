package com.justicemw.ocean_live;

import android.bluetooth.*;
import android.bluetooth.le.*;
import android.content.Context;
import android.os.*;
import io.flutter.embedding.engine.FlutterEngine;
import io.flutter.plugin.common.MethodChannel;
import java.util.*;

/** BLE peripheral plumbing only. Key material and protocol stay in Dart. */
final class PkcPeripheral {
    private static final UUID CCCD = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb");
    private final Context context;
    private final MethodChannel channel;
    private final Handler main = new Handler(Looper.getMainLooper());
    private BluetoothGattServer server;
    private BluetoothLeAdvertiser advertiser;
    private AdvertiseCallback advertisingCallback;
    private BluetoothGattCharacteristic characteristic;
    private BluetoothDevice central;
    private int generation, mtu = 23;
    private boolean subscribed;
    private MethodChannel.Result starting;

    PkcPeripheral(Context context, FlutterEngine engine) {
        this.context = context;
        channel = new MethodChannel(engine.getDartExecutor().getBinaryMessenger(), "ocean_live/pkc");
        channel.setMethodCallHandler((call, result) -> {
            try {
                switch (call.method) {
                    case "start":
                        stop();
                        generation = ((Number)call.argument("generation")).intValue();
                        start(UUID.fromString(call.argument("service")), UUID.fromString(call.argument("characteristic")), result);
                        break;
                    case "stop": stop(); result.success(null); break;
                    case "notify": {
                        byte[] bytes = call.argument("bytes");
                        Number requestGeneration = call.argument("generation");
                        if (requestGeneration == null || requestGeneration.intValue() != generation ||
                            server == null || central == null || !subscribed || bytes == null || bytes.length > mtu - 3) {
                            result.error("not_ready", "Reconnect the key; a subscribed central and sufficient MTU are required", null); return;
                        }
                        boolean sent;
                        if (Build.VERSION.SDK_INT >= 33) sent = server.notifyCharacteristicChanged(central, characteristic, false, bytes) == 0;
                        else { characteristic.setValue(bytes); sent = server.notifyCharacteristicChanged(central, characteristic, false); }
                        if (sent) result.success(null); else result.error("send", "Bluetooth did not accept the command", null);
                        break;
                    }
                    default: result.notImplemented();
                }
            } catch (Exception ignored) {
                boolean pendingStart = starting == result;
                stop();
                if (!pendingStart) result.error("bluetooth", "Bluetooth peripheral unavailable", null);
            }
        });
    }
    private void event(String name, Object... pairs) {
        Map<String,Object> data = new HashMap<>(); data.put("generation", generation);
        for (int i = 0; i < pairs.length; i += 2) data.put((String)pairs[i], pairs[i+1]);
        main.post(() -> channel.invokeMethod(name, data));
    }
    private void start(UUID serviceId, UUID characteristicId, MethodChannel.Result result) {
        BluetoothManager manager = context.getSystemService(BluetoothManager.class);
        BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
        if (adapter == null || !adapter.isEnabled() || !adapter.isMultipleAdvertisementSupported()) {
            result.error("unsupported", "Enable Bluetooth on a phone supporting BLE advertising", null); return;
        }
        final int session = generation;
        starting = result;
        advertiser = adapter.getBluetoothLeAdvertiser();
        server = manager.openGattServer(context, new BluetoothGattServerCallback() {
            @Override public void onServiceAdded(int status, BluetoothGattService service) { main.post(() -> {
                if (session != generation || server == null) return;
                if (status != BluetoothGatt.GATT_SUCCESS) { failStart(); return; }
                advertisingCallback = new AdvertiseCallback() {
                    @Override public void onStartSuccess(AdvertiseSettings settings) { main.post(() -> {
                        if (session != generation) return;
                        if (starting != null) { starting.success(null); starting = null; }
                        event("advertising");
                    }); }
                    @Override public void onStartFailure(int code) { main.post(() -> { if (session == generation) failStart(); }); }
                };
                try {
                    advertiser.startAdvertising(new AdvertiseSettings.Builder().setConnectable(true)
                        .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                        .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_MEDIUM).build(),
                        new AdvertiseData.Builder().addServiceUuid(new ParcelUuid(serviceId)).build(), advertisingCallback);
                } catch (Exception ignored) { failStart(); }
            }); }
            @Override public void onConnectionStateChange(BluetoothDevice device, int status, int state) { main.post(() -> {
                if (session != generation || server == null) return;
                if (state == BluetoothProfile.STATE_CONNECTED) {
                    if (central != null && !central.equals(device)) { server.cancelConnection(device); return; }
                    central = device; mtu = 23; subscribed = false;
                } else if (device.equals(central)) { event("disconnected"); stop(); }
            }); }
            @Override public void onMtuChanged(BluetoothDevice device, int value) { main.post(() -> {
                if (session == generation && device.equals(central)) mtu = value;
            }); }
            @Override public void onCharacteristicReadRequest(BluetoothDevice device, int id, int offset, BluetoothGattCharacteristic c) { main.post(() -> {
                if (session == generation && server != null) server.sendResponse(device,id,offset == 0 ? 0 : BluetoothGatt.GATT_INVALID_OFFSET,offset,new byte[0]);
            }); }
            @Override public void onCharacteristicWriteRequest(BluetoothDevice device, int id, BluetoothGattCharacteristic c, boolean prepared, boolean response, int offset, byte[] value) { main.post(() -> {
                if (session != generation || server == null) return;
                if (prepared || offset != 0 || value == null || value.length > 512 || !device.equals(central) || !characteristicId.equals(c.getUuid())) {
                    if (response) server.sendResponse(device,id,BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED,offset,null); return;
                }
                Map<String,Object> data = new HashMap<>(); data.put("generation",session); data.put("bytes",value);
                channel.invokeMethod("write",data,new MethodChannel.Result() {
                    @Override public void success(Object accepted) { finish(Boolean.TRUE.equals(accepted)); }
                    @Override public void error(String code,String message,Object details) { finish(false); }
                    @Override public void notImplemented() { finish(false); }
                    private void finish(boolean accepted) {
                        if (session != generation || server == null) return;
                        if (response) server.sendResponse(device,id,accepted ? 0 : BluetoothGatt.GATT_INSUFFICIENT_AUTHENTICATION,0,null);
                        if (!accepted) { event("error"); stop(); }
                    }
                });
            }); }
            @Override public void onDescriptorWriteRequest(BluetoothDevice device,int id,BluetoothGattDescriptor d,boolean prepared,boolean response,int offset,byte[] value) { main.post(() -> {
                if (session != generation || server == null) return;
                boolean valid = !prepared && offset == 0 && device.equals(central) && CCCD.equals(d.getUuid()) &&
                    (Arrays.equals(value,BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE) || Arrays.equals(value,BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE));
                if (valid) { subscribed = Arrays.equals(value,BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE); d.setValue(value); event("subscription","enabled",subscribed); }
                if (response) server.sendResponse(device,id,valid ? 0 : BluetoothGatt.GATT_REQUEST_NOT_SUPPORTED,offset,null);
            }); }
            @Override public void onDescriptorReadRequest(BluetoothDevice device,int id,int offset,BluetoothGattDescriptor d) { main.post(() -> {
                if (session == generation && server != null) server.sendResponse(device,id,offset == 0 ? 0 : BluetoothGatt.GATT_INVALID_OFFSET,offset,subscribed ? BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE : BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE);
            }); }
        });
        if (server == null) { failStart(); return; }
        BluetoothGattService service = new BluetoothGattService(serviceId,BluetoothGattService.SERVICE_TYPE_PRIMARY);
        characteristic = new BluetoothGattCharacteristic(characteristicId,
            BluetoothGattCharacteristic.PROPERTY_READ|BluetoothGattCharacteristic.PROPERTY_WRITE|BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_READ|BluetoothGattCharacteristic.PERMISSION_WRITE);
        characteristic.addDescriptor(new BluetoothGattDescriptor(CCCD,BluetoothGattDescriptor.PERMISSION_READ|BluetoothGattDescriptor.PERMISSION_WRITE));
        service.addCharacteristic(characteristic);
        if (!server.addService(service)) failStart();
        main.postDelayed(() -> { if (session == generation && starting != null) failStart(); },15000);
    }
    private void failStart() { event("error"); stop(); }
    private void stop() {
        ++generation;
        if (starting != null) { starting.error("stopped","Bluetooth key setup stopped",null); starting = null; }
        try { if (advertiser != null && advertisingCallback != null) advertiser.stopAdvertising(advertisingCallback); } catch (Exception ignored) {}
        try { if (server != null) server.close(); } catch (Exception ignored) {}
        advertiser = null; advertisingCallback = null; server = null; central = null; characteristic = null; subscribed = false; mtu = 23;
    }
}
