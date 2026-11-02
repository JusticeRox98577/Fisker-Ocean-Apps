package com.justicemw.ocean_live;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.os.Handler;
import android.os.Looper;
import androidx.car.app.*;
import androidx.car.app.model.*;
import androidx.car.app.validation.HostValidator;
import androidx.lifecycle.*;
import org.json.JSONObject;
import java.util.Locale;

public class OceanCarService extends CarAppService {
    @Override public HostValidator createHostValidator(){
        if(BuildConfig.OCEAN_DEV||(getApplicationInfo().flags&ApplicationInfo.FLAG_DEBUGGABLE)!=0)return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR;
        return new HostValidator.Builder(this).addAllowedHosts(androidx.car.app.R.array.hosts_allowlist_sample).build();
    }
    @Override public Session onCreateSession(){return new Session(){
        @Override public Screen onCreateScreen(Intent intent){return new OceanScreen(getCarContext());}
    };}
    static class OceanScreen extends Screen {
        final Handler handler=new Handler(Looper.getMainLooper());
        final Runnable tick=new Runnable(){public void run(){invalidate();handler.postDelayed(this,3000);}};
        OceanScreen(CarContext context){super(context);getLifecycle().addObserver(new DefaultLifecycleObserver(){
            @Override public void onStart(LifecycleOwner owner){handler.post(tick);}
            @Override public void onStop(LifecycleOwner owner){handler.removeCallbacks(tick);}
        });}
        String number(JSONObject data,String key,String unit){return data.isNull(key)?"—":String.format(Locale.US,"%.1f %s",data.optDouble(key),unit);}
        @Override public Template onGetTemplate(){
            JSONObject data=new JSONObject();try{data=new JSONObject(getCarContext().getSharedPreferences("ocean_flutter_display",0).getString("snapshot","{}"));}catch(Exception ignored){}
            Pane pane=new Pane.Builder()
              .addRow(new Row.Builder().setTitle("Charge").addText(number(data,"soc","%")).build())
              .addRow(new Row.Builder().setTitle("Power").addText(number(data,"power","kW")).build())
              .addRow(new Row.Builder().setTitle("Battery temp").addText(number(data,"temperature","°C")).build())
              .addRow(new Row.Builder().setTitle("Status").addText(data.optString("status","Open Ocean Live and press Start")).build()).build();
            return new PaneTemplate.Builder(pane).setTitle("Ocean Live").build();
        }
    }
}
