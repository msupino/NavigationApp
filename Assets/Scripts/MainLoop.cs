using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using CoordinateSharp;




public class MainLoop : MonoBehaviour
{

    public GameObject leg;
    public GameObject main_camera;
    public GameObject button_draw;
    public float dragSpeed = 20;
    public int camZoomStep = 5;


    // Start is called before the first frame update
    private List<FlightLeg> flight = new List<FlightLeg>();

    private List<GameObject> legs = new List<GameObject>();
    private Vector3 lastMouse;
    private Transform map_camera_transform;
    private Camera map_camera_camera;
    private float zoom;
    private bool canZoom;
    private bool drawMode;

    // static varibales to define the world scale
    private double lonConversionRate = 8.392355; //of NM=0.16666667 degrees along Longatiute
    private double latConversionRate = 10.00674; //of NM=0.16666667 degrees along Latitude
    private double NMConversionRate = 0.1666667;
    private double lonOriginRadians = 35d;
    private double latOriginRadians = 33d;

    public double flightSpeed = 90d; //TODO: Will be on the leg level



    void Start()
    {
        map_camera_transform = main_camera.transform;
        map_camera_camera = main_camera.GetComponent<Camera>();
        button_draw.GetComponent<Button>().onClick.AddListener(ToggleDrawMode);
    }


    public int ToMagnetic(int angle = 360, int divation = -4)
    {
        int result = angle + divation;
        if (result < 0)
        {
            result += 360;
        }
        return result;
    }

    public string ToHMS(double time)
    {
        var result = TimeSpan.FromHours(time);
        return result.Minutes + "' " + result.Seconds + "''"; //result.Hours + ": " +  Only return minutes seconds
    }

    public Coordinate CursorToCoordinate(Vector3 cursorPosition)
    {


        Vector3 objectPos = cursorPosition;

        double lon = ((objectPos.x / lonConversionRate) * NMConversionRate) + lonOriginRadians;
        double lat = ((objectPos.z / latConversionRate) * NMConversionRate) + latOriginRadians;


        Coordinate c = new Coordinate(lat, lon);

        //print("lon.x: " + objectPos.x + " lat.y: " + objectPos.z);
        //print("lon: " + (objectPos.x / lonConversionRate) + " lat: " + (objectPos.z / latConversionRate));
        //print("lon: " + lon + " lat: " + lat);
        //print(c);
        return c;

        // method 0, faster, less precise:



        /* method 1:
         * 
        Vector3 origin = cursorPosition;
        origin.x = 0;
        origin.z = 0;

        // x --> lon (presented as NM dist from 35E lon)
        // z --> lat (presented as NM dist from 33N lat)

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

    private void ToggleDrawMode()
    {
        drawMode = !drawMode;
        if (!drawMode) FinishDraw();
        //Debug.Log(drawMode + "< draw mode");
    }

    private void FinishDraw()
    {
        //TODO: what da fuck?
        //The mouse click is intercepted first in update() and only then the onClick is called,
        //This is causing a waypoint to get created just under the button...
        Debug.Log("Finish Drawing!");
        if (legs.Count > 0)
        {
            Destroy(legs[legs.Count - 1]);
            legs.RemoveAt(legs.Count - 1);
            Destroy(legs[legs.Count - 1]);
            legs.RemoveAt(legs.Count - 1);
        }
    }

    public Vector3 CursorLocalPosition()
    {
        var mousePos = Input.mousePosition;
        mousePos.z = 5f;       // we want 2m away from the camera position
        return Camera.main.ScreenToWorldPoint(mousePos);
    }




    //private void AddFlightLeg(string _name, Coordinate _start, Coordinate _end)
    //{
    //    flight.Add(new FlightLeg(_name, _start, _end));
    //}


    private bool FlightHasLegs()
    {
        if (flight.Count > 0) return true;
        return false;
    }

    private FlightLeg GetLastFlightLeg()
    {
        return flight[flight.Count-1];
    }

    // Update is called once per frame
    void Update()
    {
        lineDraw legScript;
        var objectPos = CursorLocalPosition();


        // This is draw mode
        // TODO: edit mode, delete mode

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

            map_camera_camera.orthographicSize = zoom;
        }


        if (Input.GetKey(KeyCode.Space))
        {
            print("spacd is pressed");
            if (Input.GetMouseButtonDown(0))
            {

                lastMouse = Input.mousePosition;
                return;
            }

            if (Input.GetMouseButton(0))
            {
                Vector3 currMouse = Input.mousePosition;
                Vector3 pos = Camera.main.ScreenToViewportPoint(lastMouse - currMouse);
                Vector3 move = new Vector3(pos.x * dragSpeed * (map_camera_camera.orthographicSize / 10), 0, pos.y * dragSpeed * (map_camera_camera.orthographicSize / 10));
                lastMouse = currMouse;
                map_camera_transform.Translate(move, Space.World);
                return;
            }
        }



        if (!drawMode)
        {
            //if (Input.GetMouseButtonDown(0))
            //{
            //    CursorToCoordinate(objectPos);
            //}
            return;
        }
        

        // Draw mode:

        if (Input.GetMouseButtonDown(0)) // mouse left was clicked
        {

            var legName = "LEG" + (flight.Count + 1);
            FlightLeg newLeg = new FlightLeg(legName);
            newLeg.CreateAtCurrentPos(this);

            flight.Add(newLeg);

        }

        // mouse in motion with the next waypoint...

        if (!FlightHasLegs()) return;

        FlightLeg lastLeg = GetLastFlightLeg();
        lastLeg.UpdateLegEndFromScreen(objectPos, this);

    }
}


public class FlightLeg
{
    public string legName;
    public Coordinate start;
    public Coordinate end;
    public GameObject leg;
    public lineDraw legScript;
    public Vector3 pointStart;
    public Vector3 pointEnd;

    public FlightLeg(string _name)
    {
        legName = _name;
    }

    public void CreateAtCurrentPos(MainLoop mainLoop)
    {
        Vector3 curPosition = mainLoop.CursorLocalPosition();
        Coordinate curCoord = mainLoop.CursorToCoordinate(curPosition);
        GameObject newLeg;

        pointStart = curPosition;
        pointEnd = curPosition;

        newLeg = UnityEngine.Object.Instantiate(mainLoop.leg, Vector3.zero, Quaternion.identity);

        leg = newLeg;
        legScript = newLeg.GetComponent<lineDraw>();
        legScript.start.position = curPosition;
        legScript.end.position = curPosition;

        start = curCoord;
        end = curCoord;

    }

    public void UpdateLegEndFromScreen(Vector3 pos, MainLoop mainLoop)

    {

        legScript.end.position = pos;
        pointEnd = pos;
        end = mainLoop.CursorToCoordinate(pos); //TODO: do I really need this like this?

        Distance legDistance = new Distance(start, end, Shape.Sphere);
        double legDistanceNM = legDistance.NauticalMiles;

        legScript.distanceText.text = legDistanceNM.ToString("n1");
        legScript.durationText.text = mainLoop.ToHMS(legDistanceNM / mainLoop.flightSpeed); //NOT HMS
        legScript.headingText.text = mainLoop.ToMagnetic(Convert.ToInt32(legDistance.Bearing)) + " M";

        leg.GetComponent<LineRenderer>().enabled = true;
    }

}