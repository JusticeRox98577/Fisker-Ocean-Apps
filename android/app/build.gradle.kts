import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Release signing: only the owner's upload key, from keystore.properties (local)
// or the ANDROID_* secrets (CI). There is no public fallback key, so nobody else
// can make a build that installs as an update over an official one.
val upload = Properties()
val uploadFile = rootProject.file("keystore.properties")
if (uploadFile.exists()) uploadFile.inputStream().use { upload.load(it) }
val uploadStore: String? = upload.getProperty("storeFile") ?: System.getenv("ANDROID_STORE_FILE")
val buildNumber = System.getenv("BUILD_NUMBER")?.toIntOrNull() ?: 3400

// "Any questions?" proxy address (see ask-proxy/README.md). Not secret, but the owner's own, so it comes
// from local.properties or the OCEAN_ASK_URL variable. Empty hides the feature.
val local = Properties()
val localFile = rootProject.file("local.properties")
if (localFile.exists()) localFile.inputStream().use { local.load(it) }
val askUrl: String = (local.getProperty("oceanAskUrl") ?: System.getenv("OCEAN_ASK_URL") ?: "").trim()
    .also { url ->
        require(url.isEmpty() || (url.startsWith("https://") && url.none { it.isWhitespace() || it == '"' || it == '\\' })) {
            "OCEAN_ASK_URL must be an https:// address"
        }
    }

android {
    namespace = "com.justicemw.oceanlive"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.justicemw.oceanlive"
        minSdk = 26
        targetSdk = 36
        versionCode = buildNumber
        versionName = "3.4.0"
        buildConfigField("String", "ASK_URL", "\"$askUrl\"")
    }
    signingConfigs {
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
            // Release builds are signed only with the owner's upload key. Without it they are left unsigned.
            if (uploadStore != null) signingConfig = signingConfigs.getByName("upload")
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
        buildConfig = true
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
    implementation("androidx.car.app:app:1.4.0")
    implementation("androidx.lifecycle:lifecycle-process:2.8.3")
    implementation("com.google.android.gms:play-services-wearable:18.2.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
