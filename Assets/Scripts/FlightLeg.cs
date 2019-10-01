using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using CoordinateSharp;
using MainLogic;

//[ExecuteInEditMode]
public class FlightLeg : MonoBehaviour
{
    
    public GameObject start;
    public GameObject end;
    
    public GameObject startSource = null;
    public GameObject endSource = null;
    public Waypoint startWaypoint = null;
    public Waypoint endWaypoint = null;
    public double flightSpeed = 90d;
    
    public GameObject perpendicular;
    public TextMesh distanceText;
    public TextMesh durationText;
    public TextMesh headingText;
    
    

    //public Coordinate startCoord;
    //public Coordinate endCoord;

    private LineRenderer lineRenderer;
    private LineRenderer middleLineRenderer;
    private Vector3 lastStart;
    private Vector3 lastEnd;
    
    private List<GameObject> minutes = new List<GameObject>();
    
    
    // Start is called before the first frame update
    private void Start()
    {
        lineRenderer = GetComponent<LineRenderer>();
        lineRenderer.startWidth = 0.1f;
        lineRenderer.endWidth = 0.1f;
        
        var middleGameObject = PerpendicularLine();
        middleLineRenderer = initLine(middleGameObject);
        
        lastStart = start.transform.position;
        lastEnd = end.transform.position;
    }

    private GameObject PerpendicularLine()
    {
        var go = Instantiate(perpendicular, Vector3.zero, Quaternion.identity);
        go.transform.SetParent(gameObject.transform);
        return go;
    }

    private LineRenderer initLine(GameObject go)
    {
        LineRenderer result = go.GetComponent<LineRenderer>();
        result.startWidth = 0.1f;
        result.endWidth = 0.1f;
        return result;
    }
    
    
    private List<Vector3> GetPerpendicularPoints(Vector3 startPosition, Vector3 endPosition, float cutPos)
    {
        var newVec = startPosition - endPosition;
        var newVector = Vector3.Cross(newVec, Vector3.up);
        newVector.Normalize();

        var newPoint = 1 * newVector + ((startPosition + endPosition) / cutPos);
        var newPoint2 = -1 * newVector + ((startPosition + endPosition) / cutPos);

        List<Vector3> result = new List<Vector3> {newPoint, newPoint2};

        return result;
    }
    
    // Update is called once per frame
    void Update()
    {

        if (startSource != null)
        {
            start.transform.position = startSource.transform.position;
        }

        if (endSource != null)
        {
            end.transform.position = endSource.transform.position;
        }

                
        var startPosition = start.transform.position;
        var endPosition = end.transform.position;
    
        
        //waypoint chanhed
        if (startPosition != lastStart || endPosition != lastEnd)
        {

            // zero out this as the last position
            lastStart = startPosition;
            lastEnd = endPosition;
            
            // update evrything...
            

            lineRenderer.SetPosition(0, startPosition);
            lineRenderer.SetPosition(1, endPosition);
            
            // draw the mid line perpendicular to the main line
            var perpPoints = GetPerpendicularPoints(startPosition, endPosition, 2f);
            
            middleLineRenderer.SetPosition(0, perpPoints[0]);
            middleLineRenderer.SetPosition(1, perpPoints[1]);


            var legDistance = new Distance(startWaypoint.coordinate, endWaypoint.coordinate, Shape.Sphere);
            var legDistanceNm = legDistance.NauticalMiles;

            distanceText.text = legDistanceNm.ToString("n1");
            durationText.text = MainLoop.ToHMS(legDistanceNm /  flightSpeed); //NOT HMS
            headingText.text =  MainLoop.ToMagnetic(Convert.ToInt32(legDistance.Bearing)) + " M";

            
            int roundedMinutes = TimeSpan.FromHours((legDistanceNm /  flightSpeed)).Minutes;
            float minuteLength = (float)legDistanceNm / ((float)(legDistanceNm /  flightSpeed)*60f);
            //print("dist " + legDistanceNm + " total minutes: " + roundedMinutes + "mLen " + minuteLength);
            // clean up exisiting minutes



            //print("minutes.Count: " + minutes.Count);

            //print("BEFORE: minutes.Count: " +  minutes.Count + " leg minutes: " + roundedMinutes);
            int ii=minutes.Count;
            while (minutes.Count > 0 &&  minutes.Count > roundedMinutes)
            {
                Destroy(minutes[ii-1]);
                minutes.RemoveAt(ii-1);
                //print("removed index: " + (ii-1));
                ii++;
            }
            

            if (roundedMinutes > 0)
            {
                //Add lines
                for (int i = minutes.Count; i <= roundedMinutes-1; i++)
                {
                    var l = PerpendicularLine();
                    minutes.Add(l);
                    //print("added minute: " + i);
                }
                
                for (int i = 0; i <= roundedMinutes-1; i++)
                {
                    var minuteLine = minutes[i];
                    //var prepP = GetPerpendicularPoints(startPosition, endPosition, 3f);
                    var minuteLineRenderer = minuteLine.GetComponent<LineRenderer>();
                    
                    var newVec = startPosition - endPosition;
                    //var newVector = Vector3.Cross(newVec, Vector3.up);
                    //newVector.Normalize();
                    newVec.Normalize();

                    var newPoint =  (minuteLength*i) * Vector3.Normalize(endPosition - startPosition) + startPosition;
                    var newPoint2 = (minuteLength*i) * Vector3.Normalize(endPosition - startPosition) + startPosition;
                    minuteLineRenderer.startWidth = 1f;
                    minuteLineRenderer.endWidth = 1f;
                    
                    minuteLineRenderer.SetPosition(0, newPoint);
                    minuteLineRenderer.SetPosition(1, newPoint2);
                }
            }
            

            
            //print("AFTER: minutes.Count: " +  minutes.Count + " leg minutes: " + roundedMinutes);
        }

    }
}
