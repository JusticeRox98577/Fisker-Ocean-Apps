import java.util.Properties
plugins {
    id("com.android.application")
    id("dev.flutter.flutter-gradle-plugin")
}
val upload = Properties()
val uploadFile = rootProject.file("keystore.properties")
if (uploadFile.exists()) uploadFile.inputStream().use { upload.load(it) }
val uploadStore = upload.getProperty("storeFile") ?: System.getenv("ANDROID_STORE_FILE")
android {
    namespace = "com.justicemw.ocean_live"
    compileSdk = 37
    ndkVersion = flutter.ndkVersion
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    defaultConfig {
        applicationId = "com.justicemw.oceanlive"
        minSdk = 26
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }
    buildFeatures { buildConfig = true; resValues = true }
    signingConfigs {
        create("dev") {
            storeFile = rootProject.file("dev-debug.keystore")
            storePassword = "android"
            keyAlias = "oceanlivedev"
            keyPassword = "android"
        }
        if (uploadStore != null) create("upload") {
            storeFile = rootProject.file(uploadStore)
            storePassword = upload.getProperty("storePassword") ?: System.getenv("ANDROID_STORE_PASSWORD")
            keyAlias = upload.getProperty("keyAlias") ?: System.getenv("ANDROID_KEY_ALIAS")
            keyPassword = upload.getProperty("keyPassword") ?: System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
    flavorDimensions += "distribution"
    productFlavors {
        create("dev") {
            dimension = "distribution"
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            signingConfig = signingConfigs.getByName("dev")
            resValue("string", "app_name", "Ocean Live Dev")
            buildConfigField("boolean", "OCEAN_DEV", "true")
        }
        create("prod") {
            dimension = "distribution"
            if (uploadStore != null) signingConfig = signingConfigs.getByName("upload")
            resValue("string", "app_name", "Ocean Live")
            buildConfigField("boolean", "OCEAN_DEV", "false")
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
}
flutter { source = "../.." }
dependencies { implementation("androidx.car.app:app:1.4.0") }
