package com.justicemw.ocean_live;
import android.app.PendingIntent;
import android.appwidget.*;
import android.content.*;
import android.widget.RemoteViews;
import org.json.JSONObject;

public class OceanWidget extends AppWidgetProvider {
    @Override public void onUpdate(Context context,AppWidgetManager manager,int[] ids){ refresh(context); }
    public static void refresh(Context context){
        AppWidgetManager manager=AppWidgetManager.getInstance(context);
        for(int id:manager.getAppWidgetIds(new ComponentName(context,OceanWidget.class))){
            RemoteViews views=new RemoteViews(context.getPackageName(),R.layout.widget_ocean);
            String value="—";
            try{JSONObject snapshot=new JSONObject(context.getSharedPreferences("ocean_flutter_display",0).getString("snapshot","{}"));
                if(!snapshot.isNull("soc"))value=Math.round(snapshot.getDouble("soc"))+"%";
            }catch(Exception ignored){}
            views.setTextViewText(R.id.widget_percent,value);
            views.setOnClickPendingIntent(R.id.widget_root,PendingIntent.getActivity(context,0,new Intent(context,MainActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT));
            manager.updateAppWidget(id,views);
        }
    }
}
