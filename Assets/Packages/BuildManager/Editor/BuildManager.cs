using UnityEditor;
using UnityEngine;
using System.IO;
using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;

using UnityEditor.Callbacks;
using UnityEditorInternal.VR;
using ycdivfx.iOS.Xcode;
using UnityEngine.SceneManagement;
using Object = UnityEngine.Object;

namespace ycdivfx
{
    public class BuildManager : EditorWindow
    {
        private static Platforms _platformBuild;
        private static bool _debugBuild;
        private static bool _newVersionMajor;
        private static bool _newVersionMinor;
        private static bool _newBuild;
        private static bool _applyManifesto;

        private static string _buildProductName;
        private static string _buildBundleIdentifier;
        private static string _buildOutput;


        private const string BTN_BUILD = "Build";
        private const string BTN_SWITCH_PLATFORM = "Switch Platform";

        private static BuildSettings _buildSettings;

        private const string SCENES_LOC = "Assets/";
        private Vector2 _scrollPos;
        private static BuildManager window;

        private List<string> _sceneList = new List<string>();
        private UnityEditorInternal.ReorderableList _sceneReorderableList;

        public enum Platforms
        {
            PC = 0,
            ANDROID,
            IOS,
            WEBGL,
            MAC,
            LINUX
        }

        public void OnEnable()
        {
            _buildSettings = BuildSettings.CreateAndLoad();
            _platformBuild = _buildSettings.Platform;
            _sceneList = _buildSettings.Scenes;
            _sceneReorderableList = new UnityEditorInternal.ReorderableList(_sceneList, typeof(string), true, true, true, true);
            _sceneReorderableList.drawHeaderCallback = rect => { GUI.Label(rect, "Scenes in build"); };
            _sceneReorderableList.drawElementCallback = (rect, index, active, focused) =>
            {
                EditorGUI.LabelField(rect, _sceneList[index].Replace(".unity", string.Empty));
            };
            _sceneReorderableList.onAddDropdownCallback = (rect, list) =>
            {
                var menu = new GenericMenu();
                menu.AddItem(new GUIContent("Add scenes from build settings"), false, () => 
                {
                    var c = SceneManager.sceneCountInBuildSettings;
                    if (c == 0) return;
                    for (var i = 0; i < c; i++)
                    {
                        var assetPath = SceneManager.GetSceneByBuildIndex(i).path;
                        if(string.IsNullOrEmpty(assetPath)) continue;
                        if (_sceneList.Any(x => string.Equals(x, assetPath, StringComparison.InvariantCultureIgnoreCase))) continue;
                        _sceneList.Add(assetPath);
                    }
                });
                menu.AddSeparator(string.Empty);
                var objs = AssetDatabase.FindAssets("t:scene");
                foreach (var obj in objs)
                {
                    var assetPath = AssetDatabase.GUIDToAssetPath(obj);
                    var sceneObj = AssetDatabase.LoadAssetAtPath<SceneAsset>(assetPath);
                    if(_sceneList.Any(x => string.Equals(x, assetPath, StringComparison.InvariantCultureIgnoreCase))) continue;
                    menu.AddItem(new GUIContent(sceneObj.name), false, () => _sceneList.Add(assetPath));
                }
                menu.ShowAsContext();
            };

        }

        public void OnDisable()
        {
            _buildSettings.Save();
            _buildSettings.Apply();
            window = null;
        }

        [MenuItem("Tools/HeadlessStudio/Build Manager")]
        public static void ShowWindow()
        {
            //if (window == null)
            //{
            window = GetWindow<BuildManager>(true, "Build Manager", true);
            //window.titleContent = new GUIContent("Build Manager");
            //var rect = window.position;
            //window.position = new Rect(rect.position, new Vector2(360, 650));
            window.CenterOnMainWin();
            window.ShowUtility();
            //}
        }

        public void OnGUI()
        {
            if (BuildPipeline.isBuildingPlayer) return;

            GUILayout.Label("App settings", EditorStyles.boldLabel);
            _buildSettings.CompanyName = EditorGUILayout.TextField("Company Name", _buildSettings.CompanyName);
            _buildSettings.ProductName = EditorGUILayout.TextField("Product Name", _buildSettings.ProductName);
            _platformBuild = (Platforms)EditorGUILayout.EnumPopup("Platform", _platformBuild);
            GUI.enabled = _platformBuild == Platforms.PC || _platformBuild == Platforms.MAC || _platformBuild == Platforms.LINUX;
            _buildSettings.BuildType = (BuildSettings.BuildTypeEnum)EditorGUILayout.EnumPopup("Type", _buildSettings.BuildType);
            GUI.enabled = true;
            _buildSettings.Platform = _platformBuild;
            string customSuffix = _buildSettings.GetCustomSuffix(false);
            string customTitle;
            switch (_platformBuild)
            {
                case Platforms.PC:
                    customTitle = "PC";
                    break;
                case Platforms.MAC:
                    customTitle = "MacOSX";
                    break;
                case Platforms.LINUX:
                    customTitle = "Linux";
                    break;
                case Platforms.ANDROID:
#if !UNITY_5_6
                    customTitle = (_buildSettings.IsGearVR ? "VR" : (_buildSettings.IsCardboard ? "Cardboard" : "Android"));
#else
                    customTitle = "Android";
#endif
                    break;
                case Platforms.IOS:
#if !UNITY_5_6
                    customTitle = (_buildSettings.IsCardboard ? "Cardboard" : "iOS");
#else
                    customTitle = "iOS";
#endif
                    break;
                case Platforms.WEBGL:
                    customTitle = "WebGL";
                    break;
                default:
                    customTitle = string.Empty;
                    break;
            }
            customSuffix = EditorGUILayout.TextField(string.Format("{0} Suffix", customTitle), customSuffix);
            _buildSettings.SetCustomSuffix(customSuffix);

            EditorGUILayout.Space();

            _sceneReorderableList.DoLayoutList();

            EditorGUILayout.Space();

            GUILayout.Label("Identification", EditorStyles.boldLabel);
            _buildSettings.BundleIdentifier = EditorGUILayout.TextField("Bundle Identifier", _buildSettings.BundleIdentifier);
            EditorGUILayout.BeginHorizontal();
            _buildSettings.BundleVersion = EditorGUILayout.TextField("Version", _buildSettings.BundleVersion);
            GUILayout.Label("b", GUILayout.Width(20));
            _buildSettings.BundleBuild = EditorGUILayout.TextField("", _buildSettings.BundleBuild, GUILayout.Width(50));
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.BeginHorizontal();
            _newVersionMajor = EditorGUILayout.Toggle("Increment", _newVersionMajor, GUILayout.MaxWidth(160));
            GUILayout.Label(".", GUILayout.MaxWidth(8));
            _newVersionMinor = EditorGUILayout.Toggle("", _newVersionMinor, GUILayout.MaxWidth(16));
            GUILayout.Label("b", GUILayout.Width(16));
            _newBuild = EditorGUILayout.Toggle("", _newBuild, GUILayout.MaxWidth(16));
            EditorGUILayout.EndHorizontal();

            EditorGUILayout.Space();

            GUILayout.Label("Build options", EditorStyles.boldLabel);
            _buildSettings.DebugBuild = EditorGUILayout.Toggle("Debug", _buildSettings.DebugBuild);
            _buildSettings.Autorun = EditorGUILayout.Toggle("Autorun", _buildSettings.Autorun);
#if !UNITY_5_6
            EditorGUILayout.Space();
            GUI.enabled = _buildSettings.Platform == Platforms.ANDROID || _buildSettings.Platform == Platforms.IOS;
            _buildSettings.IsCardboard = EditorGUILayout.Toggle("Cardboard", _buildSettings.IsCardboard);
            if (_buildSettings.IsCardboard && _buildSettings.IsGearVR) _buildSettings.IsGearVR = false;
            GUI.enabled = _buildSettings.Platform == Platforms.ANDROID;
            _buildSettings.IsGearVR = EditorGUILayout.Toggle("VR", _buildSettings.IsGearVR);
            if (_buildSettings.IsCardboard && _buildSettings.IsGearVR) _buildSettings.IsCardboard = false;

            EditorGUILayout.Space();
            GUI.enabled = _buildSettings.Platform == Platforms.ANDROID && (_buildSettings.IsGearVR || _buildSettings.IsCardboard);
            _applyManifesto = EditorGUILayout.Toggle("Custom Manifesto", _applyManifesto);
            GUI.enabled = true;
            GUI.enabled = _buildSettings.Platform == Platforms.ANDROID && !_buildSettings.IsGearVR;
#else
            GUI.enabled = _buildSettings.Platform == Platforms.ANDROID;
#endif
            _buildSettings.SplitApp = EditorGUILayout.Toggle("Split application", _buildSettings.SplitApp);
            GUI.enabled = true;

            _debugBuild = _buildSettings.DebugBuild;


            if (GUILayout.Button(BTN_BUILD))
            {
                EditorApplication.delayCall += OnClickBuild;
            }

            if (GUILayout.Button(BTN_SWITCH_PLATFORM))
            {
                EditorApplication.delayCall += SwitchPlatform;
            }

            DisplayCurrentBuildSettings();
        }

        private void SwitchPlatform()
        {
            switch (_platformBuild)
            {
                case Platforms.ANDROID:
                    if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.Android) EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.Android, BuildTarget.Android);
                    break;
                case Platforms.IOS:
                    if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.iOS) EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.iOS, BuildTarget.iOS);
                    break;
                case Platforms.PC:
                    if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.StandaloneWindows) EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.Standalone, BuildTarget.StandaloneWindows);
                    break;
                case Platforms.WEBGL:
                    if (EditorUserBuildSettings.activeBuildTarget != BuildTarget.WebGL) EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.WebGL, BuildTarget.WebGL);
                    break;
            }
        }

        void OnClickBuild()
        {
            if (_newVersionMajor) _buildSettings.IncrementMajorVersion();
            if (_newVersionMinor) _buildSettings.IncrementMinorVersion();
            if (_newBuild) _buildSettings.IncrementBuild();
            _buildSettings.Apply();
            _buildSettings.Save();

            switch (_platformBuild)
            {
                case Platforms.ANDROID:
                    BuildAndroid();
                    break;
                case Platforms.IOS:
                    BuildiOS();
                    break;
                case Platforms.PC:
                    BuildPC();
                    break;
                case Platforms.WEBGL:
                    BuildWebGL();
                    break;
            }
        }

        private void DisplayCurrentBuildSettings()
        {
            EditorGUILayout.Space();

            SetupBuildVariables();

            GUILayout.Label("Product name", EditorStyles.boldLabel);
            GUILayout.Label(_buildProductName);

            EditorGUILayout.Space();

            GUILayout.Label("Bundle identifier", EditorStyles.boldLabel);
            GUILayout.Label(_buildBundleIdentifier);

            GUILayout.Label("Output", EditorStyles.boldLabel);
            GUILayout.Label(_buildOutput);


        }

        /// <summary>
        /// Setup variables according to the platform
        /// </summary>
        private static void SetupBuildVariables()
        {
            _buildProductName = string.Format("{0} {1}",
                _buildSettings.ProductName,
                _buildSettings.GetCustomSuffix()).Trim();
            _buildBundleIdentifier = string.Format("{0}{1}",
                _buildSettings.BundleIdentifier,
                _buildSettings.GetCustomSuffix()).Replace(" ", string.Empty).ToLowerInvariant();

            var buildNumber = _newBuild ? (Convert.ToInt32(_buildSettings.BundleBuild) + 1).ToString() : _buildSettings.BundleBuild;

            var versionMajor = 0;
            var versionMinor = 1;
            if (_buildSettings.BundleVersion.Length > 1 && _buildSettings.BundleVersion.Contains("."))
            {
                try
                {
                    var version = _buildSettings.BundleVersion.Split('.');
                    versionMajor = Convert.ToInt32(version[0]) + (_newVersionMajor ? 1 : 0);
                    if (version.Length != 1)
                    {
                        versionMinor = Convert.ToInt32(version[1]);
                        if (versionMinor % 10 == versionMinor && version[1].Length == 1) versionMinor *= 10;
                        versionMinor = versionMinor + (_newVersionMinor ? 1 : 0);
                    }
                }
                catch { }
            }
            else if (_buildSettings.BundleVersion.Length >= 1 && !_buildSettings.BundleVersion.Contains("."))
            {
                versionMajor = Convert.ToInt32(_buildSettings.BundleVersion) + (_newVersionMajor ? 1 : 0);
                versionMinor = _newVersionMinor ? 1 : 0;

            }
            var versionNumber = string.Format("{0}_{1:00}", versionMajor, versionMinor);

            var debugStr = _debugBuild ? "debug_" : string.Empty;
            var sanitizeProductName = _buildProductName.Trim().Replace(" ", "_").Replace(".", string.Empty).ToLowerInvariant();

            var suffix = _buildSettings.GetCustomSuffix(false).Trim().ToLowerInvariant();
            var cleanSuffix = string.IsNullOrEmpty(suffix) ? string.Empty : string.Format("_{0}", suffix);
            switch (_platformBuild)
            {
                case Platforms.ANDROID:
                    _buildOutput = string.Format("Builds/android/{0}_{1}{2}b{3}{4}.apk",
                        sanitizeProductName,
                        debugStr,
                        versionNumber,
                        buildNumber,
                        !_buildSettings.IsGearVR && _buildSettings.SplitApp ? "_store" : "");
                    break;
                case Platforms.IOS:
                    _buildOutput = string.Format("Builds/ios/{0}_{1}{2}b{3}",
                        sanitizeProductName,
                        debugStr,
                        versionNumber,
                        buildNumber);
                    break;
                case Platforms.PC:
                    _buildOutput = string.Format("Builds/pc/{0}{1}_{2}{3}b{4}/{5}.exe",
                        sanitizeProductName,
                        cleanSuffix,
                        debugStr,
                        versionNumber,
                        buildNumber,
                        _buildProductName.ToLower().Replace(" ", "_"));
                    break;
                case Platforms.WEBGL:
                    _buildOutput = string.Format("Builds/webgl/{0}{1}_{2}{3}b{4}",
                        sanitizeProductName,
                        cleanSuffix,
                        debugStr,
                        versionNumber,
                        buildNumber);
                    break;
            }
        }

        /// <summary>
        /// Builds the app for Android.
        /// </summary>
        /// <param name="isVR">Is it a VR App?</param>
        private void BuildAndroid()
        {
            SetupBuildVariables();
            var startTime = DateTime.Now;

            _buildSettings.Apply();

            EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.Android, BuildTarget.Android);

            PlayerSettings.productName = _buildProductName;
            PlayerSettings.applicationIdentifier = _buildBundleIdentifier;
#if !UNITY_5_6
            PlayerSettings.virtualRealitySupported = _buildSettings.IsGearVR;
#endif
            PlayerSettings.Android.useAPKExpansionFiles = !_buildSettings.IsGearVR && _buildSettings.SplitApp;
            PlayerSettings.Android.preferredInstallLocation = _buildSettings.IsGearVR ? AndroidPreferredInstallLocation.ForceInternal : PlayerSettings.Android.preferredInstallLocation;

            var mainOptions = _buildSettings.Autorun ? BuildOptions.AutoRunPlayer : BuildOptions.None;
#if !UNITY_5_6
            if (_applyManifesto)
            {
                if (!File.Exists(Path.Combine(Application.dataPath, "Assets/Plugins/Android/AndroidManifest.original")))
                    FileUtil.ReplaceFile("Assets/Plugins/Android/AndroidManifest.xml", "Assets/Plugins/Android/AndroidManifest.original");

                if (_buildSettings.IsGearVR)
                    if (File.Exists(Path.Combine(Application.dataPath, "ycdivfx/Editor/extras/AndroidManifest_vr.xml")))
                        FileUtil.ReplaceFile("Assets/ycdivfx/Editor/extras/AndroidManifest_vr.xml", "Assets/Plugins/Android/AndroidManifest.xml");
                    else
                    if (File.Exists(Path.Combine(Application.dataPath, "ycdivfx/Editor/extras/AndroidManifest_cardboard.xml")))
                        FileUtil.ReplaceFile("Assets/ycdivfx/Editor/extras/AndroidManifest_cardboard.xml", "Assets/Plugins/Android/AndroidManifest.xml");
            }
#endif
            if (_buildSettings.IsGearVR)
                BuildPlatform(BuildTarget.Android, _buildSettings.Scenes.ToArray(),
                    _debugBuild
                    ? mainOptions | BuildOptions.Development
                    : mainOptions);
            else
                BuildPlatform(BuildTarget.Android, _buildSettings.Scenes.ToArray(),
                    _debugBuild
                    ? mainOptions | BuildOptions.Development | BuildOptions.AllowDebugging
                    : mainOptions);

            _buildSettings.Apply();

            var totalTime = DateTime.Now - startTime;
            Debug.Log("Build time (Android): " + totalTime.Minutes.ToString("00") + ":" + totalTime.Seconds.ToString("00"));
        }

        /// <summary>
        /// Build the app for iOS.
        /// </summary>
        private void BuildiOS()
        {
            SetupBuildVariables();
            var startTime = DateTime.Now;

            _buildSettings.Apply();

            EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.iOS, BuildTarget.iOS);

            PlayerSettings.productName = _buildProductName;
            PlayerSettings.applicationIdentifier = _buildBundleIdentifier;
#if !UNITY_5_6
            PlayerSettings.virtualRealitySupported = false;
#endif
            PlayerSettings.SetScriptingBackend(BuildTargetGroup.iOS, ScriptingImplementation.IL2CPP);
            BuildPlatform(BuildTarget.iOS, _buildSettings.Scenes.ToArray(), BuildOptions.None);

            _buildSettings.Apply();

            var totalTime = DateTime.Now - startTime;
            Debug.Log("Build time (iOS): " + totalTime.Minutes.ToString("00") + ":" + totalTime.Seconds.ToString("00"));
        }

        /// <summary>
        /// Builds the app for PC.
        /// </summary>
        private void BuildPC()
        {
            SetupBuildVariables();
            var startTime = DateTime.Now;

            CleanupFolder();

            _buildSettings.Apply();
#if !UNITY_5_6
            PlayerSettings.virtualRealitySupported = false;
#endif
            EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.Standalone, BuildTarget.StandaloneWindows);

            var buildOptions = _debugBuild ? BuildOptions.AutoRunPlayer | BuildOptions.Development | BuildOptions.AllowDebugging : BuildOptions.None;
            BuildPlatform(_buildSettings.BuildType == BuildSettings.BuildTypeEnum.x86 ? BuildTarget.StandaloneWindows : BuildTarget.StandaloneWindows64, _buildSettings.Scenes.ToArray(), buildOptions);

            _buildSettings.Apply();

            if (!_debugBuild) CleanupPDBs();

            var totalTime = DateTime.Now - startTime;
            Debug.Log("Build time (PC): " + totalTime.Minutes.ToString("00") + ":" + totalTime.Seconds.ToString("00"));
        }

        /// <summary>
        /// Build the app for WebGL.
        /// </summary>
        private void BuildWebGL()
        {
            SetupBuildVariables();
            var startTime = DateTime.Now;

            CleanupFolder();

            _buildSettings.Apply();

            PlayerSettings.virtualRealitySupported = false;

            SwitchPlatform();

            var colorSpace = PlayerSettings.colorSpace;
            PlayerSettings.colorSpace = ColorSpace.Gamma;
            BuildPlatform(BuildTarget.WebGL, _buildSettings.Scenes.ToArray(), _debugBuild ? BuildOptions.AutoRunPlayer | BuildOptions.Development | BuildOptions.AllowDebugging : BuildOptions.None);
            PlayerSettings.colorSpace = colorSpace;

            _buildSettings.Apply();

            var totalTime = DateTime.Now - startTime;
            Debug.Log("Build time (WebGL): " + totalTime.Minutes.ToString("00") + ":" + totalTime.Seconds.ToString("00"));
        }

        /// <summary>
        /// Cleanup all the pdb's.
        /// </summary>
        private void CleanupPDBs()
        {
            if (Directory.Exists(Path.GetDirectoryName(_buildOutput)))
            {
                foreach (var filename in Directory.GetFiles(Path.GetDirectoryName(_buildOutput), "*.pdb"))
                {
                    File.Delete(filename);
                }
            }
            Debug.Log("Clean up PDB's");
        }

        /// <summary>
        /// Cleanup the build folder.
        /// </summary>
        private void CleanupFolder()
        {
            var folder = Path.HasExtension(_buildOutput) ? Path.GetDirectoryName(_buildOutput) : _buildOutput;
            if (Directory.Exists(folder))
            {
                Directory.Delete(folder, true);
            }
            Debug.Log("Clean up folder: " + folder);
        }

        /// <summary>
        /// Get app scenes.
        /// </summary>
        /// <param name="scenes">Scenes.</param>
        /// <returns></returns>
        private string[] GetScenes(string[] scenes)
        {
            int len = scenes.Length;
            string[] _scenes = new string[len];

            for (int i = 0; i < len; i++) { _scenes[i] = scenes[i]; }
            // for (int i = 0; i < len; i++) { _scenes[i] = SCENES_LOC + scenes[i]; }
            return _scenes;
        }

        /// <summary>
        /// Builds for the given build target.
        /// </summary>
        /// <param name="bt">Build target.</param>
        /// <param name="scenes">Scenes to include.</param>
        /// <param name="bo">Build options.</param>
        private void BuildPlatform(BuildTarget bt, string[] scenes, BuildOptions bo)
        {

            if (BuildPipeline.isBuildingPlayer) return;

            var pathToCreate = _buildOutput;
            if (Path.HasExtension(_buildOutput))
                pathToCreate = Path.GetDirectoryName(_buildOutput);

            if (!Directory.Exists(pathToCreate))
                Directory.CreateDirectory(pathToCreate);

            if (_buildSettings.IsCardboard && (bt == BuildTarget.Android || bt == BuildTarget.iOS))
            {
                VRDeviceInfoEditor[] allVRDeviceInfo = VREditor.GetAllVRDeviceInfo(bt == BuildTarget.Android ? BuildTargetGroup.Android : BuildTargetGroup.iOS);
                VREditor.SetVREnabledOnTargetGroup(bt == BuildTarget.Android ? BuildTargetGroup.Android : BuildTargetGroup.iOS, true);
                VREditor.SetVREnabledDevicesOnTargetGroup(BuildTargetGroup.Android, new[] { allVRDeviceInfo.Select(_ => _.deviceNameKey).FirstOrDefault(_ => _.ToLowerInvariant().StartsWith("cardboard")) });
            }
            else if (_buildSettings.IsGearVR && bt == BuildTarget.Android)
            {
                VRDeviceInfoEditor[] allVRDeviceInfo = VREditor.GetAllVRDeviceInfo(BuildTargetGroup.Android);
                VREditor.SetVREnabledOnTargetGroup(BuildTargetGroup.Android, true);
                VREditor.SetVREnabledDevicesOnTargetGroup(BuildTargetGroup.Android, new[] { allVRDeviceInfo.Select(_ => _.deviceNameKey).FirstOrDefault(_ => _.ToLowerInvariant().StartsWith("oculus")) });

            }

            
            var error = BuildPipeline.BuildPlayer(GetScenes(scenes), _buildOutput, bt, bo);

            if (!string.IsNullOrEmpty(error.ToString()))
                Debug.LogError(error);
        }

        [PostProcessBuild(900)]
        public static void FixiOSBuild(BuildTarget platform, string projectPath)
        {
            if (platform != BuildTarget.iOS || !_buildSettings.IsCardboard)
                return;

            string pbxFile = PBXProject.GetPBXProjectPath(projectPath);
            PBXProject pbxProject = new PBXProject();
            pbxProject.ReadFromFile(pbxFile);
            string target = pbxProject.TargetGuidByName(PBXProject.GetUnityTargetName());
            pbxProject.AddBuildProperty(target, "LIBRARY_SEARCH_PATHS", @"$(SRCROOT)/Libraries/Plugins/iOS");
            pbxProject.SetBuildProperty(target, "ENABLE_BITCODE", "NO");
            pbxProject.WriteToFile(pbxFile);
        }

#region For Cmdline build
        private static BuildManager Init()
        {
            var buildManager = new BuildManager();
            buildManager.OnEnable();
            UpdateBuild();
            return buildManager;
        }

        private static void UpdateBuild()
        {
            var regex = new Regex(@"-increment\s+(?<type>(minor\|build)|(major\|build)|major|minor|build)");
            var match = regex.Match(Environment.CommandLine);
            var matchGroup = match.Groups["type"];
            var increment = string.Empty;
            if (matchGroup != null && !string.IsNullOrEmpty(matchGroup.Value))
                increment = matchGroup.Value;

            if (increment.Contains("major")) _buildSettings.IncrementMajorVersion();
            if (increment.Contains("minor")) _buildSettings.IncrementMinorVersion();
            if (increment.Contains("build")) _buildSettings.IncrementBuild();
            _buildSettings.Save();
            _buildSettings.DebugBuild = !Regex.IsMatch(Environment.CommandLine, @"-debug");
            Debug.LogFormat("Building version {0}b{1}", _buildSettings.BundleVersion, _buildSettings.BundleBuild);

        }

        private static string GetOutputPath()
        {
            var regex = new Regex(@"-outputpath\s+(?<path>"".*""|[^""\s]*)");
            var match = regex.Match(Environment.CommandLine);
            var matchGroup = match.Groups["path"];
            var path = string.Empty;
            if (matchGroup != null && !string.IsNullOrEmpty(matchGroup.Value))
                path = Environment.ExpandEnvironmentVariables(matchGroup.Value);
            return path;
        }

        private static void CopyFileAndFolders(string path, string outputPath)
        {
            foreach (var newPath in Directory.GetFiles(outputPath, "*.*",
                                                       SearchOption.AllDirectories))
            {
                var targetFile = newPath.Replace(outputPath, path);
                var dir = Path.GetDirectoryName(targetFile);
                if (dir != null && !Directory.Exists(dir)) Directory.CreateDirectory(dir);
                File.Copy(newPath, targetFile, true);
            }
        }

        public static void PerformAndroidBuild()
        {
            var buildManager = Init();
            _platformBuild = Platforms.ANDROID;
            buildManager.BuildAndroid();
            var path = GetOutputPath();
            if (string.IsNullOrEmpty(path)) return;
            File.Copy(_buildOutput, _buildOutput.Replace(_buildOutput, path), true);
        }

        public static void PerformIOSBuild()
        {
            var buildManager = Init();
            _platformBuild = Platforms.IOS;
            buildManager.BuildiOS();
            var path = GetOutputPath();
            if (string.IsNullOrEmpty(path)) return;
            foreach (var newPath in Directory.GetFiles(_buildOutput, "*.*",
                                                       SearchOption.AllDirectories))
                File.Copy(newPath, newPath.Replace(_buildOutput, path), true);
        }

        public static void PerformPCBuild()
        {
            Debug.Log("Starting PC build");
            try
            {
                var buildManager = Init();
                _platformBuild = Platforms.PC;
                buildManager.BuildPC();
                var path = GetOutputPath();
                if (string.IsNullOrEmpty(path)) return;
                path = Path.GetFullPath(path);
                var outputPath = Path.GetDirectoryName(_buildOutput);
                outputPath = Path.GetFullPath(Application.dataPath + "/../" + outputPath);
                Console.WriteLine("Copying PC build from '{0}' to '{1}'", outputPath, path);
                CopyFileAndFolders(path, outputPath);
            }
            catch (Exception e)
            {
                Debug.Log(string.Format("Build gave an error: {0}", e));
            }
        }

        public static void PerformWebGLBuild()
        {
            Debug.Log("Starting WebGL build");
            try
            {
                var buildManager = Init();
                _platformBuild = Platforms.WEBGL;
                buildManager.BuildWebGL();
                var path = GetOutputPath();
                if (string.IsNullOrEmpty(path)) return;
                var outputPath = Path.GetFullPath(Application.dataPath + "/../" + _buildOutput);
                Console.WriteLine("Copying WebGL build from '{0}' to '{1}'", outputPath, path);
                CopyFileAndFolders(path, outputPath);
            }
            catch (Exception e)
            {
                Debug.Log(string.Format("Build gave an error: {0} - {1}", e, e.StackTrace));
            }
        }
#endregion
    }

    public class BuildSettings
    {
        public enum BuildTypeEnum
        {
            x64,
            x86
        }

        public string CompanyName;
        public string ProductName;
        public string BundleIdentifier;
        public string BundleVersion;
        public string BundleBuild;
        public BuildTypeEnum BuildType;
        public BuildManager.Platforms Platform;
        public string CustomPCSuffix = "";
        public string CustomAndroidSuffix = "";
        public string CustomAndroidCardboardSuffix = "Cardboard";
        public string CustomVRSuffix = "VR";
        public string CustomIOSSuffix = "";
        public string CustomIOSCardboardSuffix = "Cardboard";
        public string CustomWebGLSuffix = "";
        public bool IsCardboard;
        public bool IsGearVR;
        public bool SplitApp;
        public List<string> Scenes = new List<string>();

        public bool DebugBuild;
        public bool Autorun;

        [NonSerialized]
        private static readonly string Filename;

        [NonSerialized]
        private static bool _isLoading;

        static BuildSettings()
        {
            Filename = Path.Combine(Application.dataPath, "BuildSettings.json");
        }

        public BuildSettings()
        {
            CompanyName = PlayerSettings.companyName;
            ProductName = PlayerSettings.productName;
            BundleIdentifier = PlayerSettings.applicationIdentifier;
            BundleVersion = PlayerSettings.bundleVersion;
            BundleBuild = PlayerSettings.Android.bundleVersionCode.ToString();
            Platform = BuildManager.Platforms.PC;
            BuildType = BuildTypeEnum.x64;
            DebugBuild = false;
        }

        public void Save()
        {
            File.WriteAllText(Filename, JsonUtility.ToJson(this));
            //var json = AssetDatabase.LoadAssetAtPath<TextAsset>(Filename);
            //EditorUtility.SetDirty(json);
            //AssetDatabase.ImportAsset(Filename);
            AssetDatabase.Refresh();
            AssetDatabase.SaveAssets();
        }

        public static BuildSettings CreateAndLoad()
        {
            if (!File.Exists(Filename))
                return new BuildSettings();

            var jsonString = File.ReadAllText(Filename);
            return JsonUtility.FromJson<BuildSettings>(jsonString);
        }

        public string GetCustomSuffix(bool onlyMobile = true)
        {
            switch (Platform)
            {
                case BuildManager.Platforms.PC:
                    return onlyMobile ? string.Empty : CustomPCSuffix;
                case BuildManager.Platforms.ANDROID:
                    if (IsGearVR)
                        return CustomVRSuffix;
                    return IsCardboard ? CustomAndroidCardboardSuffix : CustomAndroidSuffix;
                case BuildManager.Platforms.IOS:
                    return IsCardboard ? CustomIOSCardboardSuffix : CustomIOSSuffix;
                case BuildManager.Platforms.WEBGL:
                    return onlyMobile ? string.Empty : CustomWebGLSuffix;
            }
            return string.Empty;
        }

        public void SetCustomSuffix(string suffix)
        {
            switch (Platform)
            {
                case BuildManager.Platforms.PC:
                    CustomPCSuffix = suffix;
                    break;
                case BuildManager.Platforms.ANDROID:
                    if (IsGearVR)
                        CustomVRSuffix = suffix;
                    else if (IsCardboard) CustomAndroidCardboardSuffix = suffix;
                    else CustomAndroidSuffix = suffix;
                    break; ;
                case BuildManager.Platforms.IOS:
                    if (IsCardboard) CustomIOSCardboardSuffix = suffix;
                    else CustomIOSSuffix = suffix;
                    break; ;
                case BuildManager.Platforms.WEBGL:
                    CustomWebGLSuffix = suffix;
                    break;
            }
        }

        public void Apply()
        {
            PlayerSettings.companyName = CompanyName;
            PlayerSettings.productName = ProductName;
            PlayerSettings.applicationIdentifier = BundleIdentifier;
            PlayerSettings.bundleVersion = BundleVersion;
            PlayerSettings.Android.bundleVersionCode = Convert.ToInt32(BundleBuild);
            PlayerSettings.iOS.buildNumber = BundleBuild;
            PlayerSettings.Android.useAPKExpansionFiles = !IsGearVR && SplitApp;
        }

        public void IncrementMajorVersion()
        {
            var version = new Version(BundleVersion);
            BundleVersion = string.Format("{0}.{1}", version.Major + 1, version.Minor);
        }

        public void IncrementMinorVersion()
        {
            var version = BundleVersion.Split('.');
            var versionMinor = Convert.ToInt32(version[1]);
            if (versionMinor % 10 == versionMinor && version[1].Length == 1) versionMinor *= 10;
            versionMinor++;
            BundleVersion = string.Format("{0}.{1:00}", version[0], versionMinor);
        }

        public void IncrementBuild()
        {
            BundleBuild = (Convert.ToInt32(BundleBuild) + 1).ToString();
        }
    }
}