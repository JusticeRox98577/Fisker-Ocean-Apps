#import "AppDelegate.h"
#import "GeneratedPluginRegistrant.h"
#import <UserNotifications/UserNotifications.h>

// Swift packages such as Firebase reference these marker symbols from Apple's Swift
// back-deployment libraries. The libraries are not needed for iOS 17 and newer, and
// recent Xcode versions no longer ship them, so the linker would fail without these.
__attribute__((used)) void *_swift_FORCE_LOAD_$_swiftCompatibility56 = 0;
__attribute__((used)) void *_swift_FORCE_LOAD_$_swiftCompatibilityConcurrency = 0;
__attribute__((used)) void *_swift_FORCE_LOAD_$_swiftCompatibilityPacks = 0;

@implementation AppDelegate
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    self.oceanEngine = [[FlutterEngine alloc] initWithName:@"ocean" project:nil allowHeadlessExecution:YES];
    [self.oceanEngine run];
    [GeneratedPluginRegistrant registerWithRegistry:self.oceanEngine];
    self.oceanChannel = [FlutterMethodChannel methodChannelWithName:@"ocean_live/platform" binaryMessenger:self.oceanEngine.binaryMessenger];
    [self.oceanChannel setMethodCallHandler:^(FlutterMethodCall *call, FlutterResult result) {
        NSUserDefaults *defaults = NSUserDefaults.standardUserDefaults;
        if ([call.method isEqualToString:@"legacySettings"]) {
            NSMutableDictionary *saved = NSMutableDictionary.dictionary;
            for (NSString *key in @[@"apiKey",@"token",@"interval",@"model",@"capacityKWh",@"useKm",@"useF",@"autoStart",@"keepOn",@"estSOC",@"learnedCap",@"ocv"]) {
                id value=[defaults objectForKey:key]; if(value) saved[key]=value;
            }
            NSString *adapter=[defaults stringForKey:@"adapterID"];if(adapter)saved[@"adapterAddr"]=adapter;
            result(saved);
        } else if ([call.method isEqualToString:@"finishMigration"]) {
            [defaults removeObjectForKey:@"apiKey"];[defaults removeObjectForKey:@"token"];result(nil);
        } else if ([call.method isEqualToString:@"snapshot"]) {
            NSMutableDictionary *display=[call.arguments mutableCopy];
            for(NSString *key in [display.allKeys copy])if(display[key]==NSNull.null)[display removeObjectForKey:key];
            [defaults setObject:display forKey:@"ocean_flutter_display"];
            [[NSNotificationCenter defaultCenter] postNotificationName:@"OceanSnapshot" object:nil];result(nil);
        } else if ([call.method isEqualToString:@"keepScreenOn"]) {
            UIApplication.sharedApplication.idleTimerDisabled=[call.arguments boolValue];result(nil);
        } else if ([call.method isEqualToString:@"notify"]) {
            NSDictionary *args=call.arguments;
            UNMutableNotificationContent *content=UNMutableNotificationContent.new;
            content.title=args[@"title"]?:@"Ocean Live";content.body=args[@"body"]?:@"";
            content.sound=UNNotificationSound.defaultSound;
            UNNotificationRequest *request=[UNNotificationRequest requestWithIdentifier:[args[@"id"] description] content:content trigger:nil];
            [UNUserNotificationCenter.currentNotificationCenter addNotificationRequest:request withCompletionHandler:nil];result(nil);
        } else if ([call.method isEqualToString:@"startBackground"] || [call.method isEqualToString:@"stopBackground"]) {
            // Background BLE/location lifetimes are managed by CoreBluetooth/CoreLocation plugins.
            result(nil);
        } else {result(FlutterMethodNotImplemented);}
    }];
    return [super application:application didFinishLaunchingWithOptions:options];
}
@end
int main(int argc,char *argv[]) {
    @autoreleasepool {return UIApplicationMain(argc,argv,nil,NSStringFromClass(AppDelegate.class));}
}
