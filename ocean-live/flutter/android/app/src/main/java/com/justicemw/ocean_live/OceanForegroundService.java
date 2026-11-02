package com.justicemw.ocean_live;

import android.Manifest;
import android.app.*;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.os.*;

public class OceanForegroundService extends Service {
    private PowerManager.WakeLock wake;
    @Override public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("ocean_running", "Live telemetry", NotificationManager.IMPORTANCE_LOW));
        Notification notification = new Notification.Builder(this,"ocean_running")
            .setSmallIcon(R.drawable.ic_notif).setContentTitle("Ocean Live is running")
            .setContentText("Reading vehicle data. Open the app to stop.")
            .setOngoing(true).setContentIntent(PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT)).build();
        if (Build.VERSION.SDK_INT >= 29) {
            int type = 0;
            if (Build.VERSION.SDK_INT < 31 || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE;
            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
            if (type == 0) type = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC;
            startForeground(25,notification,type);
        } else startForeground(25,notification);
        wake = ((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"ocean:telemetry");
        wake.acquire(12*60*60*1000L);
    }
    @Override public int onStartCommand(Intent intent,int flags,int startId) { return START_NOT_STICKY; }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() { if(wake!=null&&wake.isHeld())wake.release(); super.onDestroy(); }
    @Override public void onTimeout(int startId,int type) {
        ((OceanApplication)getApplication()).channel.invokeMethod("toggle",null); stopSelf();
    }
}
