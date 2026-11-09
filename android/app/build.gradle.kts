import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Same signing setup as Ocean Live 2.0 so V3 installs over it as an update:
// a Play upload key from keystore.properties or CI secrets, otherwise the
// public dev-debug.keystore for sideloaded GitHub builds.
val upload = Properties()
val uploadFile = rootProject.file("keystore.properties")
if (uploadFile.exists()) uploadFile.inputStream().use { upload.load(it) }
val uploadStore: String? = upload.getProperty("storeFile") ?: System.getenv("ANDROID_STORE_FILE")
val buildNumber = System.getenv("BUILD_NUMBER")?.toIntOrNull() ?: 3000

android {
    namespace = "com.justicemw.oceanlive"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.justicemw.oceanlive"
        minSdk = 26
        targetSdk = 36
        versionCode = buildNumber
        versionName = "3.0.0"
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
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    testImplementation("junit:junit:4.13.2")
}
