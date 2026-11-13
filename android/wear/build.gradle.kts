import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// The watch app must be signed with the same key as the phone app, or the two can't
// share data. Same setup as app/build.gradle.kts: a Play upload key from
// keystore.properties or CI secrets, otherwise the public dev-debug.keystore.
val upload = Properties()
val uploadFile = rootProject.file("keystore.properties")
if (uploadFile.exists()) uploadFile.inputStream().use { upload.load(it) }
val uploadStore: String? = upload.getProperty("storeFile") ?: System.getenv("ANDROID_STORE_FILE")
val buildNumber = System.getenv("BUILD_NUMBER")?.toIntOrNull() ?: 3310

android {
    namespace = "com.justicemw.oceanlive.wear"
    compileSdk = 36

    defaultConfig {
        // Same application ID as the phone app: required for the Data Layer.
        applicationId = "com.justicemw.oceanlive"
        minSdk = 30
        targetSdk = 36
        // Same build number as the phone app, offset so Play sees a different version code
        // for the watch (two uploads of one app can't share a version code).
        versionCode = 100_000 + buildNumber
        // Keep in step with versionName in app/build.gradle.kts.
        versionName = "3.3.1"
    }
    signingConfigs {
        create("public") {
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
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName(if (uploadStore != null) "upload" else "public")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.wear.compose:compose-material:1.4.0")
    implementation("androidx.wear.compose:compose-foundation:1.4.0")
    implementation("com.google.android.gms:play-services-wearable:18.2.0")
    implementation("androidx.wear.tiles:tiles:1.4.1")
    implementation("androidx.wear.protolayout:protolayout:1.2.1")
    implementation("androidx.wear.protolayout:protolayout-material:1.2.1")
    implementation("androidx.wear.protolayout:protolayout-expression:1.2.1")
    implementation("androidx.wear.watchface:watchface-complications-data-source-ktx:1.2.1")
    implementation("androidx.concurrent:concurrent-futures:1.2.0")
    testImplementation("junit:junit:4.13.2")
}
