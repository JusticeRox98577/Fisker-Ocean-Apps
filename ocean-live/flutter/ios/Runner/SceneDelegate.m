#import <Flutter/Flutter.h>
#import <UIKit/UIKit.h>
#import <CarPlay/CarPlay.h>
#import "AppDelegate.h"

@interface SceneDelegate : FlutterSceneDelegate
@end
@implementation SceneDelegate
- (void)scene:(UIScene *)scene willConnectToSession:(UISceneSession *)session options:(UISceneConnectionOptions *)options {
    if (![scene isKindOfClass:UIWindowScene.class]) return;
    AppDelegate *app=(AppDelegate *)UIApplication.sharedApplication.delegate;
    self.window=[[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
    self.window.rootViewController=[[FlutterViewController alloc] initWithEngine:app.oceanEngine nibName:nil bundle:nil];
    [self.window makeKeyAndVisible];
    [super scene:scene willConnectToSession:session options:options];
}
@end

@interface CarPlaySceneDelegate : UIResponder<CPTemplateApplicationSceneDelegate>
@property(nonatomic,strong) CPInterfaceController *controller;
@property(nonatomic,strong) NSTimer *timer;
@end
@implementation CarPlaySceneDelegate
- (void)templateApplicationScene:(CPTemplateApplicationScene *)scene didConnectInterfaceController:(CPInterfaceController *)controller {
    self.controller=controller;[self refresh];
    __weak CarPlaySceneDelegate *weakSelf=self;
    self.timer=[NSTimer scheduledTimerWithTimeInterval:3 repeats:YES block:^(NSTimer *timer){[weakSelf refresh];}];
}
- (void)templateApplicationScene:(CPTemplateApplicationScene *)scene didDisconnectInterfaceController:(CPInterfaceController *)controller {
    [self.timer invalidate];self.timer=nil;self.controller=nil;
}
- (NSString *)number:(NSDictionary *)data key:(NSString *)key unit:(NSString *)unit {
    id value=data[key];if(!value||value==NSNull.null)return @"—";
    return [NSString stringWithFormat:@"%.1f %@",[value doubleValue],unit];
}
- (void)refresh {
    NSDictionary *data=[NSUserDefaults.standardUserDefaults dictionaryForKey:@"ocean_flutter_display"]?:@{};
    NSArray *items=@[
      [[CPInformationItem alloc] initWithTitle:@"Charge" detail:[self number:data key:@"soc" unit:@"%"]],
      [[CPInformationItem alloc] initWithTitle:@"Power" detail:[self number:data key:@"power" unit:@"kW"]],
      [[CPInformationItem alloc] initWithTitle:@"Battery temp" detail:[self number:data key:@"temperature" unit:@"°C"]],
      [[CPInformationItem alloc] initWithTitle:@"Status" detail:data[@"status"]?:@"Open Ocean Live and press Start"]];
    CPInformationTemplate *view=[[CPInformationTemplate alloc] initWithTitle:@"Ocean Live" layout:CPInformationTemplateLayoutLeading items:items actions:@[]];
    [self.controller setRootTemplate:view animated:NO completion:nil];
}
@end
