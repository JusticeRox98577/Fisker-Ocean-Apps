package com.justicemw.oceanlive.obd

import androidx.annotation.StringRes
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.justicemw.oceanlive.R
import com.justicemw.oceanlive.Strings

/** The module's plain name as a string resource, or null for a module not in the list (shown by its English [Ecu.name]). */
@StringRes
fun ecuNameRes(code: String): Int? = when (code) {
    "BMS" -> R.string.ecu_bms
    "BCM" -> R.string.ecu_bcm
    "VCU" -> R.string.ecu_vcu
    "MCU_F" -> R.string.ecu_mcu_f
    "MCU_R" -> R.string.ecu_mcu_r
    "PDU" -> R.string.ecu_pdu
    "PIU" -> R.string.ecu_piu
    "WTC" -> R.string.ecu_wtc
    "BTC" -> R.string.ecu_btc
    "ECC" -> R.string.ecu_ecc
    "RAC" -> R.string.ecu_rac
    "ESP" -> R.string.ecu_esp
    "IBOOSTER" -> R.string.ecu_ibooster
    "EPS" -> R.string.ecu_eps
    "EPS2" -> R.string.ecu_eps2
    "ACU" -> R.string.ecu_acu
    "PKC" -> R.string.ecu_pkc
    "ICC" -> R.string.ecu_icc
    "GW" -> R.string.ecu_gw
    "TBOX_EU" -> R.string.ecu_tbox_eu
    "TBOX_US" -> R.string.ecu_tbox_us
    "HYDRA" -> R.string.ecu_hydra
    "FCM" -> R.string.ecu_fcm
    "MRR" -> R.string.ecu_mrr
    "CMRR_FL" -> R.string.ecu_cmrr_fl
    "CMRR_FR" -> R.string.ecu_cmrr_fr
    "CMRR_RL" -> R.string.ecu_cmrr_rl
    "CMRR_RR" -> R.string.ecu_cmrr_rr
    "OHC" -> R.string.ecu_ohc
    "CIM" -> R.string.ecu_cim
    "MFSS" -> R.string.ecu_mfss
    "DSMC" -> R.string.ecu_dsmc
    "PSM" -> R.string.ecu_psm
    "PWC_L" -> R.string.ecu_pwc_l
    "PWC_R" -> R.string.ecu_pwc_r
    "PLGM" -> R.string.ecu_plgm
    "TRM" -> R.string.ecu_trm
    "AMP" -> R.string.ecu_amp
    "VSP" -> R.string.ecu_vsp
    else -> null
}

/** The module's plain name in the phone's language. */
fun Ecu.displayName(s: Strings): String = ecuNameRes(code)?.let { s.get(it) } ?: name

/** The module's plain name in the phone's language, inside Compose. */
@Composable
fun Ecu.displayName(): String = ecuNameRes(code)?.let { stringResource(it) } ?: name
