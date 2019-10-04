using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.EventSystems;
using UnityEngine.Animations;
using CoordinateSharp;


namespace MainLogic
{

    public class MainLoop : MonoBehaviour
    {

        public GameObject crosshair;
        public GameObject drawIndicator;
        public GameObject waypoint;
        public GameObject leg;
        public GameObject mainCamera;
        public GameObject buttonDraw;
        public float dragSpeed = 20;
        public int camZoomStep = 5;


        // Start is called before the first frame update
        private List<GameObject> waypoints = new List<GameObject>();
        private List<FlightLegContainer> flight = new List<FlightLegContainer>();
        private Vector3 lastMouse;
        private Transform mapCameraTransform;
        private Camera mapCameraCamera;
        private float zoom;
        private bool canZoom;
        private bool drawMode;

        // static varibales to define the world scale
        private static double lonConversionRate = 8.392355; //of NM=0.16666667 degrees along Longatiute
        private static double latConversionRate = 10.00674; //of NM=0.16666667 degrees along Latitude
        private static double NMConversionRate = 0.1666667;
        private static double lonOriginRadians = 35d;
        private static double latOriginRadians = 33d;

        private bool resumeDrawing;

        public double flightSpeed = 90d; //TODO: Will be on the leg level


        private void Start()
        {
            mapCameraTransform = mainCamera.transform;
            mapCameraCamera = mainCamera.GetComponent<Camera>();
            buttonDraw.GetComponent<Button>().onClick.AddListener(ToggleDrawMode);
        }


        public static int ToMagnetic(int angle = 360, int divation = -4)
        {
            int result = angle + divation;
            if (result < 0)
            {
                result += 360;
            }

            return result;
        }

        public static string ToHMS(double time)
        {
            var result = TimeSpan.FromHours(time);
            var seconds = (int)Math.Round(result.Seconds / 5.0) * 5;
            return result.Minutes + ":" + seconds.ToString("D2"); //result.Hours + ": " +  Only return minutes seconds
        }

        public static Coordinate SceneToCoordinate(Vector3 cursorPosition)
        {
            // x --> lon (presented as NM dist from 35E lon)
            // z --> lat (presented as NM dist from 33N lat)

            Vector3 objectPos = cursorPosition;
            double lon = ((objectPos.x / lonConversionRate) * NMConversionRate) + lonOriginRadians;
            double lat = ((objectPos.z / latConversionRate) * NMConversionRate) + latOriginRadians;
            Coordinate c = new Coordinate(lat, lon);
            //print("lon.x: " + objectPos.x + " lat.y: " + objectPos.z);
            //print("lon: " + (objectPos.x / lonConversionRate) + " lat: " + (objectPos.z / latConversionRate));
            //print("lon: " + lon + " lat: " + lat);
            //print(c);
            return c;

            /* more precise method:
            
            Vector3 origin = cursorPosition;
            origin.x = 0;
            origin.z = 0;
    
            //print("x: " + objectPos.x + " y: " + objectPos.y + " z: " + objectPos.z);
    
            // get angle from origin to cursor point
            float angle = Mathf.Atan2(objectPos.x - origin.x, objectPos.z - origin.z) * Mathf.Rad2Deg;
            if (angle < 0) angle = 1 * angle + 360;
    
            // convert the dist in NM to Meters
            float dist_as_NM = Vector3.Distance(origin, objectPos);
            float dist_as_Meteres = dist_as_NM * 1852;//new Distance(dist_as_NM, DistanceType.NauticalMiles).Meters;
    
            //print("Caculate using: distance(NM): " + dist_as_NM + " distance(Meters): " + dist_as_Meteres + " heading: " + angle);
    
            Coordinate c = new Coordinate(33.0, 35.0);
            c.Move(dist_as_Meteres, angle, Shape.Sphere);
    
            //print("Pressed at: " + c);
            return null;
            */

        }

        public Vector3 CursorLocalPosition()
        {
            var mousePos = Input.mousePosition;
            mousePos.z = 5f; // we want 2m away from the camera position
            return Camera.main.ScreenToWorldPoint(mousePos);
        }


        private void ToggleDrawMode()
        {
            drawMode = !drawMode;
            if (!drawMode)
            {
                FinishDraw();
                drawIndicator.SetActive(false);
            }
            else
            {
                drawIndicator.SetActive(true);
            }

            if (drawMode && FlightHasLegs()) resumeDrawing = true;
        }


        private void FinishDraw()
        {
            if (FlightHasLegs()) RemoveLastLeg();
        }


        private bool FlightHasLegs()
        {
            if (flight.Count > 0) return true;
            return false;
        }

        private FlightLegContainer GetLastFlightLeg()
        {
            return flight[flight.Count - 1];
        }


        private void RemoveLastLeg()
        {
            FlightLegContainer lastLeg = flight[flight.Count - 1];
            Destroy(lastLeg.EndWp); //Destory the gameObject
            Destroy(lastLeg.Leg); //Destory the gameObject
            waypoints.RemoveAt(waypoints.Count - 1);
            flight.RemoveAt(flight.Count - 1);
        }

        private GameObject CreateWaypoint(Vector3 pos)
        {
            GameObject wp = Instantiate(waypoint, pos, Quaternion.identity);
            waypoints.Add(wp);
            
            return wp;
        }

        private void CreateLeg(GameObject startWp, GameObject endWp)
        {
            var legName = "LEG" + (flight.Count + 1);
            FlightLegContainer newLeg = new FlightLegContainer(legName, startWp, endWp, leg);
            flight.Add(newLeg);
        }
        
        // Update is called once per frame
        void Update()
        {
            var objectPos = CursorLocalPosition();
            // TODO: edit mode, delete mode

            crosshair.transform.position = objectPos;

            if (Input.GetKeyDown("d")) ToggleDrawMode();

            ////////////////////////////////////////////////////////////
            // Screen navigation logic /////////////////////////////////
            if (Input.GetAxis("Mouse ScrollWheel") > 0 && zoom > 5)
            {
                zoom -= camZoomStep;
                canZoom = true;
            }

            if (Input.GetAxis("Mouse ScrollWheel") < 0 && zoom < 100)
            {
                zoom += camZoomStep;
                canZoom = true;
            }

            if (canZoom)
            {

                mapCameraCamera.orthographicSize = zoom;
            }


            if (Input.GetKey(KeyCode.Space))
            {
                if (Input.GetMouseButtonDown(0))
                {

                    lastMouse = Input.mousePosition;
                    return;
                }

                if (Input.GetMouseButton(0))
                {
                    var curMouse = Input.mousePosition;
                    var pos = Camera.main.ScreenToViewportPoint(lastMouse - curMouse);
                    var orthographicSize = mapCameraCamera.orthographicSize;
                    var move = new Vector3(pos.x * dragSpeed * (orthographicSize / 10), 0,
                        pos.y * dragSpeed * (orthographicSize / 10));
                    lastMouse = curMouse;
                    mapCameraTransform.Translate(move, Space.World);
                    return;
                }
            }

            ////////////////////////////////////////////////////////////
            // End of Screen navigation logic //////////////////////////

            if (!drawMode) return;

            // Draw mode:
            if (Input.GetMouseButtonDown(0) && !EventSystem.current.IsPointerOverGameObject()) // mouse left was clicked
            {
                GameObject wp1;
                if (!FlightHasLegs())
                {
                    wp1 = CreateWaypoint(objectPos);
                }
                else
                {
                    wp1 = flight[flight.Count - 1].EndWp;
                }
                
                var wp2 = CreateWaypoint(objectPos);
                CreateLeg(wp1, wp2);
            }
            else if (resumeDrawing)
            {
                var wp1 = flight[flight.Count - 1].EndWp;
                var wp2 = CreateWaypoint(wp1.transform.position);
                CreateLeg(wp1, wp2);
                resumeDrawing = false;
            }
            
            // mouse in motion with the next waypoint...
            if (!FlightHasLegs()) return;
            waypoints[waypoints.Count - 1].transform.position = objectPos;

        }
    }

}

public class FlightLegContainer
{
    public string LegName;
    public GameObject StartWp;
    public GameObject EndWp;
    public GameObject Leg;
    public FlightLeg LegScript;
 
    
    private ConstraintSource startCnsSource;
    private ConstraintSource endCnsSource;
    
    public FlightLegContainer(string name, GameObject _startWp, GameObject _endWp, GameObject _legPrefab)
    {
        LegName = name;
        StartWp = _startWp;
        EndWp = _endWp;
        
        var newLeg = UnityEngine.Object.Instantiate(_legPrefab, Vector3.zero, Quaternion.identity);

        Leg = newLeg;
        LegScript = newLeg.GetComponent<FlightLeg>();
        LegScript.startSource = StartWp;
        LegScript.endSource = EndWp;
        
        LegScript.startWaypoint = StartWp.GetComponent<Waypoint>();
        LegScript.endWaypoint = EndWp.GetComponent<Waypoint>();
        
        Leg.GetComponent<LineRenderer>().enabled = true;

    }

}