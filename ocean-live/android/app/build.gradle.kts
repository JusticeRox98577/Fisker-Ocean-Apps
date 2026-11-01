import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.justice.oceanlive"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.justicemw.oceanlive"
        minSdk = 26
        targetSdk = 36
        versionCode = 17
        versionName = "1.8.1"
    }

    val keyProps = Properties()
    val keyFile = rootProject.file("keystore.properties")
    if (keyFile.exists()) keyProps.load(keyFile.inputStream())

    signingConfigs {
        if (keyFile.exists()) {
            create("upload") {
                storeFile = rootProject.file(keyProps.getProperty("storeFile"))
                storePassword = keyProps.getProperty("storePassword")
                keyAlias = keyProps.getProperty("keyAlias")
                keyPassword = keyProps.getProperty("keyPassword")
            }
        }
    }

    signingConfigs {
        // A fixed key for the Dev build, so each Dev build installs over the last one.
        // This key is not secret. It only signs the test version.
        create("dev") {
            storeFile = rootProject.file("dev-debug.keystore")
            storePassword = "android"
            keyAlias = "oceanlivedev"
            keyPassword = "android"
        }
    }

    buildTypes {
        // Dev is for testing new features. It installs next to the public app.
        debug {
            applicationIdSuffix = ".dev"
            versionNameSuffix = "-dev"
            signingConfig = signingConfigs.getByName("dev")
            resValue("string", "app_name", "Ocean Live Dev")
        }
        // Release is the public Beta that goes to Google Play.
        release {
            isMinifyEnabled = false
            resValue("string", "app_name", "Ocean Live")
            if (keyFile.exists()) signingConfig = signingConfigs.getByName("upload")
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
        buildConfig = true
        compose = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.car.app:app:1.4.0")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.material3:material3")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
}
