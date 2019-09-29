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
    private LineRenderer middleLineRendered;
    private GameObject middle;
    private Vector3 lastStart;
    private Vector3 lastEnd;
    
    
    // Start is called before the first frame update
    private void Start()
    {
        lineRenderer = GetComponent<LineRenderer>();
        lineRenderer.startWidth = 0.1f;
        lineRenderer.endWidth = 0.1f;
  
        middle = Instantiate(perpendicular, Vector3.zero, Quaternion.identity);
        middle.transform.SetParent(gameObject.transform);
        middleLineRendered = middle.GetComponent<LineRenderer>();
        middleLineRendered.startWidth = 0.1f;
        middleLineRendered.endWidth = 0.1f;
        
        lastStart = start.transform.position;
        lastEnd = end.transform.position;
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
            

            var newVec = startPosition - endPosition;
            var newVector = Vector3.Cross(newVec, Vector3.up);
            newVector.Normalize();

            var newPoint = 1 * newVector + ((startPosition + endPosition) / 2);
            var newPoint2 = -1 * newVector + ((startPosition + endPosition) / 2);

            middleLineRendered.SetPosition(0, newPoint);
            middleLineRendered.SetPosition(1, newPoint2);

            middle.SetActive(true);
            
            var legDistance = new Distance(startWaypoint.coordinate, endWaypoint.coordinate, Shape.Sphere);
            var legDistanceNm = legDistance.NauticalMiles;

            distanceText.text = legDistanceNm.ToString("n1");
            durationText.text = MainLoop.ToHMS(legDistanceNm /  flightSpeed); //NOT HMS
            headingText.text =  MainLoop.ToMagnetic(Convert.ToInt32(legDistance.Bearing)) + " M";
        }

    }
}
