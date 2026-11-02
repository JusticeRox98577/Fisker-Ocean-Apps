package com.justice.oceanlive

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.plugins.ClientRequestException
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import java.util.Base64
import java.security.KeyPairGenerator

/*
 Gradle dependencies needed

 implementation("io.ktor:ktor-client-okhttp:2.3.12")
 implementation("io.ktor:ktor-client-content-negotiation:2.3.12")
 implementation("io.ktor:ktor-serialization-kotlinx-json:2.3.12")
 plugins { kotlin("plugin.serialization") }

 Manifest needs the INTERNET permission
*/

@Serializable
data class ShortStatsResponse(val data: ShortStats = ShortStats())

@Serializable
data class ShortStats(
    val online: Boolean = false,
    @SerialName("online_hmi") val onlineHmi: Boolean = false,
    val battery: Battery = Battery(),
    @SerialName("battery_12v") val battery12v: Battery12v = Battery12v(),
    @SerialName("max_range") val maxRange: MaxRange = MaxRange(),
    val doors: Doors = Doors(),
    val location: Location = Location(),
    @SerialName("door_locks") val doorLocks: DoorLocks = DoorLocks(),
    @SerialName("cabin_climate") val cabinClimate: CabinClimate = CabinClimate(),
    @SerialName("ambient_temperature") val ambientTemperature: Temp = Temp(),
    @SerialName("cell_temp") val cellTemp: CellTemp = CellTemp(),
    @SerialName("vehicle_speed") val vehicleSpeed: Speed = Speed(),
    val gear: Gear = Gear(),
    @SerialName("state_of_charge") val stateOfCharge: StateOfCharge = StateOfCharge(),
    val updated: String = ""
)

@Serializable
data class Battery(
    val percent: Int = 0,
    @SerialName("total_miles_odometer") val totalMilesOdometer: Int = 0,
    @SerialName("total_kilometers_odometer") val totalKilometersOdometer: Int = 0
)

@Serializable
data class Battery12v(
    val voltage: Double = 0.0,
    @SerialName("percent_charge") val percentCharge: Double = 0.0,
    val health: Int = 0
)

@Serializable
data class MaxRange(
    @SerialName("max_range_miles") val miles: Int = 0,
    @SerialName("max_range_kilometers") val kilometers: Int = 0
)

@Serializable
data class Doors(
    val hood: Boolean = false,
    @SerialName("left_front") val leftFront: Boolean = false,
    @SerialName("left_rear") val leftRear: Boolean = false,
    @SerialName("right_front") val rightFront: Boolean = false,
    @SerialName("right_rear") val rightRear: Boolean = false,
    val trunk: Boolean = false
)

@Serializable
data class Location(
    val altitude: Double = 0.0,
    val longitude: Double = 0.0,
    val latitude: Double = 0.0
)

@Serializable
data class DoorLocks(val driver: Boolean = false, val all: Boolean = false)

@Serializable
data class CabinClimate(
    @SerialName("internal_temperature_fahrenheit") val internalF: Int = 0,
    @SerialName("internal_temperature_celsius") val internalC: Int = 0
)

@Serializable
data class Temp(val temperature: Int = 0)

@Serializable
data class CellTemp(@SerialName("avg_battery_temp") val avgBatteryTemp: Int = 0)

@Serializable
data class Speed(val speed: Int = 0)

@Serializable
data class Gear(@SerialName("in_park") val inPark: Boolean = true)

@Serializable
data class StateOfCharge(val usable: Int = 0, val health: Int = 0)

// No defaults here so every field is always sent
@Serializable
data class LoginRequest(
    val extUserId: String,
    val fleetId: Int,
    val token: String,
    val cryptoVersion: String,
    val b64PublicKey: String
)

class FiskerClient(
    private var sdkBearer: String,
    private val extUserId: String,
    private val fleetId: Int,
    private val sdkToken: String,
    private val http: HttpClient = HttpClient(OkHttp) {
        expectSuccess = true
        install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true; isLenient = true }) }
    },
    private val refreshBearer: (suspend () -> String?)? = null
) {

    private var loggedIn = false

    // RSA 2048 public key in X.509 form, base64 encoded, same shape as the app sends
    private val publicKeyB64: String by lazy {
        val pair = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        Base64.getEncoder().encodeToString(pair.public.encoded)
    }

    private suspend fun login() {
        val res: JsonElement = http.post("https://ccc.skipti.com/api/v1/goloopsdk/login") {
            header(HttpHeaders.Accept, "application/json")
            header(HttpHeaders.Authorization, "Bearer $sdkBearer")
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(extUserId, fleetId, sdkToken, "1.0", publicKeyB64))
        }.body()
        // The SDK response contains reservations and key material, not a new bearer.
        // The native O Loop SDK uses the Auth0 access token for both login and stats.
        require((res as? JsonObject)?.get("success")?.toString() != "false") { "Vehicle login was not accepted." }
        loggedIn = true
    }

    private suspend fun fetch(vin: String, bearer: String): ShortStats {
        val res: ShortStatsResponse = http.get("https://ccc.skipti.com/api/v1/fisker/shortstats") {
            parameter("vin", vin)
            header(HttpHeaders.Accept, "application/json")
            header(HttpHeaders.ContentType, "application/json")
            header(HttpHeaders.Authorization, "Bearer $bearer")
        }.body()
        return res.data
    }

    suspend fun shortStats(vin: String): ShortStats {
        return try {
            if (!loggedIn) login()
            fetch(vin, sdkBearer)
        } catch (e: ClientRequestException) {
            if (e.response.status != HttpStatusCode.Unauthorized) throw e
            sdkBearer = refreshBearer?.invoke()
                ?: throw IllegalArgumentException("Online session expired. Sign in to O Loop again in Settings.")
            loggedIn = false
            login()
            fetch(vin, sdkBearer)
        }
    }
}

// Renamed from UiState because Engine.kt already defines UiState in this package
sealed interface CarUiState {
    data object Loading : CarUiState
    data class Success(val stats: ShortStats) : CarUiState
    data class Error(val message: String) : CarUiState
}

class CarViewModel : ViewModel() {

    // Replace with your real values, ideally loaded from EncryptedSharedPreferences
    private val client = FiskerClient(
        sdkBearer = "YOUR_SDK_BEARER_JWT",
        extUserId = "YOUR_EMAIL",
        fleetId = 5,
        sdkToken = "YOUR_LOGIN_TOKEN_UUID"
    )
    private val vin = "YOUR_VIN"

    private val _state = MutableStateFlow<CarUiState>(CarUiState.Loading)
    val state: StateFlow<CarUiState> = _state

    fun refresh() {
        viewModelScope.launch {
            _state.value = CarUiState.Loading
            _state.value = try {
                CarUiState.Success(client.shortStats(vin))
            } catch (e: Exception) {
                CarUiState.Error(e.message ?: "Request failed")
            }
        }
    }
}

/*
 Example use in Compose

 val vm: CarViewModel = viewModel()
 val state by vm.state.collectAsState()
 LaunchedEffect(Unit) { vm.refresh() }
 when (val s = state) {
     is CarUiState.Success -> Text("Battery ${s.stats.battery.percent}%  Range ${s.stats.maxRange.miles} mi")
     is CarUiState.Error -> Text(s.message)
     CarUiState.Loading -> CircularProgressIndicator()
 }
*/
