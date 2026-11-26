package com.hasad.rafid360

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Color
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Bundle
import android.os.Environment
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.provider.MediaStore
import android.util.Base64
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.PermissionRequest
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.webkit.WebViewAssetLoader

class MainActivity : Activity(), SensorEventListener {

    private lateinit var web: WebView
    private lateinit var sensors: SensorManager
    private var rotSensor: Sensor? = null
    private var absolute = true
    private val quat = FloatArray(4)
    private var lastSend = 0L
    private var pendingRequest: PermissionRequest? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        window.statusBarColor = Color.BLACK
        window.navigationBarColor = Color.BLACK

        web = WebView(this)
        web.setBackgroundColor(Color.BLACK)
        setContentView(web)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.mediaPlaybackRequiresUserGesture = false
        web.settings.allowFileAccess = false

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                return loader.shouldInterceptRequest(request.url)
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(request.resources)
                    } else {
                        pendingRequest = request
                        requestPermissions(arrayOf(Manifest.permission.CAMERA), REQ_CAMERA)
                    }
                }
            }
        }
        web.addJavascriptInterface(Bridge(), "Android")

        sensors = getSystemService(Context.SENSOR_SERVICE) as SensorManager
        rotSensor = sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
        if (rotSensor == null) {
            rotSensor = sensors.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
            absolute = false
        }

        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.CAMERA), REQ_STARTUP)
        }
        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val ok = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        val req = pendingRequest
        pendingRequest = null
        if (req != null) {
            if (ok) req.grant(req.resources) else req.deny()
        }
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        rotSensor?.let { sensors.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
    }

    override fun onPause() {
        sensors.unregisterListener(this)
        web.onPause()
        super.onPause()
    }

    override fun onSensorChanged(event: SensorEvent) {
        val now = SystemClock.uptimeMillis()
        if (now - lastSend < 30) return
        lastSend = now
        // quat = [w, x, y, z], device frame -> world (East, North, Up)
        SensorManager.getQuaternionFromVector(quat, event.values)
        web.evaluateJavascript(
            "window.onRot&&onRot(${quat[1]},${quat[2]},${quat[3]},${quat[0]})", null
        )
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("window.onBack?String(onBack()):'false'") { result ->
            if (result == null || !result.contains("true")) {
                finish()
            }
        }
    }

    inner class Bridge {
        /** Physical sensor size (mm) and focal length (mm) of the main back camera. */
        @JavascriptInterface
        fun lens(): String {
            return try {
                val cm = getSystemService(Context.CAMERA_SERVICE) as CameraManager
                var out = "{}"
                for (id in cm.cameraIdList) {
                    val ch = cm.getCameraCharacteristics(id)
                    if (ch.get(CameraCharacteristics.LENS_FACING) != CameraCharacteristics.LENS_FACING_BACK) continue
                    val size = ch.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE) ?: continue
                    val focals = ch.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS) ?: continue
                    if (focals.isEmpty()) continue
                    out = "{\"sw\":${size.width},\"sh\":${size.height},\"f\":${focals[0]}}"
                    break
                }
                out
            } catch (e: Exception) {
                "{}"
            }
        }

        @JavascriptInterface
        fun isAbsolute(): Boolean = absolute

        @JavascriptInterface
        fun vibrate(ms: Int) {
            try {
                @Suppress("DEPRECATION")
                val v = getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                v.vibrate(VibrationEffect.createOneShot(ms.toLong(), VibrationEffect.DEFAULT_AMPLITUDE))
            } catch (e: Exception) {
            }
        }

        /** Saves a base64 JPEG into Pictures/Rafid360. */
        @JavascriptInterface
        fun saveImage(b64: String, name: String): Boolean {
            return try {
                val bytes = Base64.decode(b64, Base64.DEFAULT)
                val values = ContentValues()
                values.put(MediaStore.Images.Media.DISPLAY_NAME, name)
                values.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                values.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Rafid360")
                val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                if (uri == null) {
                    false
                } else {
                    contentResolver.openOutputStream(uri)?.use { it.write(bytes) }
                    true
                }
            } catch (e: Exception) {
                false
            }
        }
    }

    companion object {
        private const val REQ_CAMERA = 1
        private const val REQ_STARTUP = 2
    }
}
