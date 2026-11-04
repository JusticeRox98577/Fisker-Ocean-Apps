package com.justicemw.ocean_live.pkc;

import android.annotation.SuppressLint;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothGattCharacteristic;
import android.bluetooth.BluetoothGattDescriptor;
import android.bluetooth.BluetoothGattServer;
import android.bluetooth.BluetoothGattServerCallback;
import android.bluetooth.BluetoothGattService;
import android.bluetooth.BluetoothManager;
import android.bluetooth.le.AdvertiseCallback;
import android.bluetooth.le.AdvertiseData;
import android.bluetooth.le.AdvertiseSettings;
import android.bluetooth.le.BluetoothLeAdvertiser;
import android.content.Context;
import android.os.ParcelUuid;
import java.util.UUID;

/**
 * Drives the vehicle's phone-as-key BLE flow on the Android side: the phone
 * is the BLE peripheral and GATT *server* here (the vehicle's module connects
 * to the phone as the central), which is why this can't live in a normal
 * Flutter BLE client package - it needs android.bluetooth.le's
 * BluetoothLeAdvertiser and a real BluetoothGattServer.
 *
 * Dev-build only (see AppConfig.devBuild / OCEAN_DEV on the Dart side, and
 * PkcPlugin's own BuildConfig.OCEAN_DEV guard) - this isn't wired into the
 * public app.
 */
public final class PkcKeyManager {
    public interface Listener {
        void onStatus(String status); // "advertising" | "connected" | "disconnected" | "error:<msg>"
        void onCommandAck(String command, boolean ok);
    }

    private final Context context;
    private final Listener listener;

    private BluetoothGattServer gattServer;
    private BluetoothLeAdvertiser advertiser;
    private BluetoothGattCharacteristic characteristic;
    private BluetoothDevice connectedDevice;

    private byte[] vaKeyBytes;
    private byte[] randomNumber; // 4 bytes, supplied by the vehicle once connected
    private int freshness = 0;

    public PkcKeyManager(Context context, Listener listener) {
        this.context = context;
        this.listener = listener;
    }

    @SuppressLint("MissingPermission")
    public void connect(String vaKeyHex) {
        disconnect(); // clear any previous session first
        this.vaKeyBytes = PkcProtocol.vaKeyToBytes(vaKeyHex);
        this.randomNumber = null;
        this.freshness = 0;

        BluetoothManager manager = context.getSystemService(BluetoothManager.class);
        BluetoothAdapter adapter = manager.getAdapter();
        if (adapter == null || !adapter.isEnabled()) {
            listener.onStatus("error:bluetooth_disabled");
            return;
        }
        advertiser = adapter.getBluetoothLeAdvertiser();
        if (advertiser == null) {
            listener.onStatus("error:advertising_unsupported");
            return;
        }

        String sessionId = PkcProtocol.deriveSessionId(vaKeyBytes);
        UUID serviceUuid = UUID.fromString(PkcProtocol.serviceUuidFor(sessionId));
        UUID characteristicUuid = UUID.fromString(PkcProtocol.CHARACTERISTIC_UUID);

        gattServer = manager.openGattServer(context, gattServerCallback);
        BluetoothGattService service = new BluetoothGattService(serviceUuid, BluetoothGattService.SERVICE_TYPE_PRIMARY);
        characteristic = new BluetoothGattCharacteristic(
                characteristicUuid,
                BluetoothGattCharacteristic.PROPERTY_WRITE | BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE
                        | BluetoothGattCharacteristic.PROPERTY_NOTIFY,
                BluetoothGattCharacteristic.PERMISSION_WRITE);
        BluetoothGattDescriptor cccd = new BluetoothGattDescriptor(
                UUID.fromString("00002902-0000-1000-8000-00805f9b34fb"),
                BluetoothGattDescriptor.PERMISSION_READ | BluetoothGattDescriptor.PERMISSION_WRITE);
        characteristic.addDescriptor(cccd);
        service.addCharacteristic(characteristic);
        gattServer.addService(service);

        AdvertiseSettings settings = new AdvertiseSettings.Builder()
                .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
                .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
                .setConnectable(true)
                .build();
        AdvertiseData data = new AdvertiseData.Builder()
                .addServiceUuid(new ParcelUuid(serviceUuid))
                .setIncludeDeviceName(false)
                .build();
        advertiser.startAdvertising(settings, data, advertiseCallback);
        listener.onStatus("advertising");
    }

    @SuppressLint("MissingPermission")
    public void disconnect() {
        try {
            if (advertiser != null) advertiser.stopAdvertising(advertiseCallback);
        } catch (Exception ignored) {}
        try {
            if (gattServer != null) {
                if (connectedDevice != null) gattServer.cancelConnection(connectedDevice);
                gattServer.close();
            }
        } catch (Exception ignored) {}
        gattServer = null;
        advertiser = null;
        characteristic = null;
        connectedDevice = null;
        randomNumber = null;
        freshness = 0;
        listener.onStatus("disconnected");
    }

    public void lock() {
        send("lock", PkcProtocol.COMMAND_TYPE_VEHICLE, PkcProtocol.CMD_LOCK);
    }

    public void unlock() {
        send("unlock", PkcProtocol.COMMAND_TYPE_VEHICLE, PkcProtocol.CMD_UNLOCK);
    }

    @SuppressLint("MissingPermission")
    private void send(String name, int commandType, byte[] command) {
        if (gattServer == null || characteristic == null || connectedDevice == null) {
            listener.onCommandAck(name, false);
            return;
        }
        if (randomNumber == null) {
            // The vehicle hasn't handed us a session nonce yet; nothing to authenticate with.
            listener.onCommandAck(name, false);
            return;
        }
        freshness++;
        byte[] frame = PkcProtocol.buildOutgoingFrame(commandType, command, randomNumber, freshness, vaKeyBytes);
        characteristic.setValue(frame);
        boolean ok = gattServer.notifyCharacteristicChanged(connectedDevice, characteristic, false);
        listener.onCommandAck(name, ok);
    }

    private final AdvertiseCallback advertiseCallback = new AdvertiseCallback() {
        @Override public void onStartFailure(int errorCode) {
            listener.onStatus("error:advertise_failed_" + errorCode);
        }
    };

    private final BluetoothGattServerCallback gattServerCallback = new BluetoothGattServerCallback() {
        @Override
        @SuppressLint("MissingPermission")
        public void onConnectionStateChange(BluetoothDevice device, int status, int newState) {
            if (newState == android.bluetooth.BluetoothProfile.STATE_CONNECTED) {
                connectedDevice = device;
                listener.onStatus("connected");
            } else if (newState == android.bluetooth.BluetoothProfile.STATE_DISCONNECTED) {
                if (device.equals(connectedDevice)) connectedDevice = null;
                randomNumber = null;
                listener.onStatus("disconnected");
            }
        }

        @Override
        public void onCharacteristicWriteRequest(BluetoothDevice device, int requestId,
                BluetoothGattCharacteristic requestedCharacteristic, boolean preparedWrite,
                boolean responseNeeded, int offset, byte[] value) {
            if (responseNeeded && gattServer != null) {
                gattServer.sendResponse(device, requestId, android.bluetooth.BluetoothGatt.GATT_SUCCESS, offset, null);
            }
            PkcProtocol.IncomingFrame frame = PkcProtocol.parseIncomingFrame(value);
            if (frame == null) return;
            if (frame.header == PkcProtocol.HEADER_RANDOM_NUMBER_UPDATE && frame.payload.length >= 4) {
                byte[] next = new byte[4];
                System.arraycopy(frame.payload, 0, next, 0, 4);
                randomNumber = next;
            }
        }

        @Override
        public void onDescriptorWriteRequest(BluetoothDevice device, int requestId,
                BluetoothGattDescriptor descriptor, boolean preparedWrite, boolean responseNeeded,
                int offset, byte[] value) {
            if (responseNeeded && gattServer != null) {
                gattServer.sendResponse(device, requestId, android.bluetooth.BluetoothGatt.GATT_SUCCESS, offset, value);
            }
        }
    };
}
