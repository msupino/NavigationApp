package org.supino.navaid.wear

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * The latest picture from the phone, for the screen, the tile and the complication. Kept in
 * SharedPreferences too, so a tile or complication drawn after the process died still has it
 * (and shows its age honestly rather than nothing).
 */
object NavStore {
    const val PATH = "/navaid/nav"
    private const val PREFS = "navaid-wear"
    private const val KEY = "picture"

    private val state = MutableStateFlow<NavPicture?>(null)
    val picture: StateFlow<NavPicture?> = state

    fun load(ctx: Context): NavPicture? {
        state.value?.let { return it }
        val json = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, null) ?: return null
        return NavPicture.parse(json)?.also { state.value = it }
    }

    fun update(ctx: Context, json: String) {
        val p = NavPicture.parse(json) ?: return
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY, json).apply()
        state.value = p
    }

    fun clear(ctx: Context) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).apply()
        state.value = null
    }
}
