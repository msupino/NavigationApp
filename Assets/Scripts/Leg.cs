using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using CoordinateSharp;
using UnityEngine.Animations;


public struct MinuteMarker
{
    public GameObject Marker;
    public GameObject Text;

}

public struct MinutePair
{
    public MinuteMarker Inbound;
    public MinuteMarker Outbound;

}

//[ExecuteInEditMode]
public class Leg : MonoBehaviour
{
    
    public GameObject start;
    public GameObject end;
    
    public GameObject startSource = null;
    public GameObject endSource = null;
    public Waypoint startWaypoint = null;
    public Waypoint endWaypoint = null;
    public double flightSpeed = 90d;

    public GameObject legInfo;
    public GameObject emptyLine;
    public GameObject minuteText;
    public TextMesh distanceText;
    public TextMesh durationText;
    public TextMesh headingText;
    public bool dirty;



    //public Coordinate startCoord;
    //public Coordinate endCoord;

    private LineRenderer lineRenderer;
    //private LineRenderer middleLineRenderer;
    private Vector3 lastStart;
    private Vector3 lastEnd;
    private GameObject inboundLegInfo;
    private GameObject outboundLegInfo;
    private GameObject inboundDriftGO;
    private GameObject outboundDriftGO;
    private LineRenderer inboundDrift;
    private LineRenderer outboundDrift;
    
    
    private List<MinutePair> minutes = new List<MinutePair>();
    
    
    // Start is called before the first frame update
    private void Start()
    {
        lineRenderer = GetComponent<LineRenderer>();
        lineRenderer.startWidth = 0.1f;
        lineRenderer.endWidth = 0.1f;

        //var middleGameObject = PerpendicularLine();
        //middleLineRenderer = initLine(middleGameObject);

        lastStart = start.transform.position;
        lastEnd = end.transform.position;

        inboundLegInfo = Instantiate(legInfo, Vector3.zero, Quaternion.identity);
        inboundLegInfo.transform.SetParent(gameObject.transform);
        inboundLegInfo.SetActive(true);
        outboundLegInfo = Instantiate(legInfo, Vector3.zero, Quaternion.identity);
        outboundLegInfo.transform.SetParent(gameObject.transform);
        outboundLegInfo.GetComponent<RotationConstraint>().rotationOffset = new Vector3(0, 0, 0);
        outboundLegInfo.SetActive(true);

        Material dashedMat = Resources.Load("dashedReadStencil", typeof(Material)) as Material;

        inboundDriftGO = Instantiate(emptyLine, Vector3.zero, Quaternion.identity);
        inboundDriftGO.transform.SetParent(gameObject.transform);
        inboundDriftGO.GetComponent<Renderer>().material = dashedMat;
        inboundDrift = inboundDriftGO.GetComponent<LineRenderer>();
        inboundDrift.positionCount = 2;
        inboundDrift.startWidth = 0.05f;
        inboundDrift.endWidth = 0.05f;

        outboundDriftGO = Instantiate(emptyLine, Vector3.zero, Quaternion.identity);
        outboundDriftGO.transform.SetParent(gameObject.transform);
        outboundDriftGO.GetComponent<Renderer>().material = dashedMat;
        outboundDrift = outboundDriftGO.GetComponent<LineRenderer>();
        outboundDrift.positionCount = 2;
        outboundDrift.startWidth = 0.05f;
        outboundDrift.endWidth = 0.05f;


    }

    private GameObject PerpendicularLine()
    {
        var go = Instantiate(emptyLine, Vector3.zero, Quaternion.identity);
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

    private bool IsEven(int number)
    {
        if(number%2 == 0)
        {
            return true;
        }else
        {
            return false;
        }
    }
    
    // Update is called once per frame
    void Update()
    {

        if (startSource == null || endSource == null) return;
        
        // if (startSource != null)
        // {
        start.transform.position = startSource.transform.position;
        // }

        // if (endSource != null)
        // {
        end.transform.position = endSource.transform.position;
        // }

                
        var startPosition = start.transform.position;
        var endPosition = end.transform.position;
    
        
        //waypoint changed
        if ((startPosition != lastStart || endPosition != lastEnd) || dirty)
        {

            dirty = false;    
            // zero out this as the last position
            lastStart = startPosition;
            lastEnd = endPosition;

            // update everything...


            lineRenderer.SetPosition(0, startPosition);
            lineRenderer.SetPosition(1, endPosition);

            //// draw the mid line perpendicular to the main line
            //var perpPoints = GetPerpendicularPoints(startPosition, endPosition, 2f);

            //middleLineRenderer.SetPosition(0, perpPoints[0]);
            //middleLineRenderer.SetPosition(1, perpPoints[1]);


            var legDistance = new Distance(startWaypoint.coordinate, endWaypoint.coordinate, Shape.Sphere);
            var legDistanceNm = legDistance.NauticalMiles;

            distanceText.text = legDistanceNm.ToString("n1");
            //durationText.text = MainLoop.ToHMS(legDistanceNm /  flightSpeed); //NOT HMS
            //headingText.text =  MainLoop.ToMagnetic(Convert.ToInt32(legDistance.Bearing)).ToString("D3") + " M";





            // draw Leg info arrows
            var newVec = startPosition - endPosition;
            var newVector = Vector3.Cross(newVec, Vector3.up);
            newVector.Normalize();


            var bearing = Main.ToMagnetic(Convert.ToInt32(legDistance.Bearing));
            var inverseBearing = (bearing + 180) % 360;
            var durationMinutes = Main.ToHMS(legDistanceNm / flightSpeed);


            var inboundLegInfoHeading = inboundLegInfo.transform.GetChild(0).gameObject;
            inboundLegInfoHeading.GetComponent<TextMesh>().text = bearing.ToString("D3");
            var inboundLegInfoDuration = inboundLegInfo.transform.GetChild(1).gameObject; //TODO: how to I get the childs in a nicer fashion?
            inboundLegInfoDuration.GetComponent<TextMesh>().text = durationMinutes; //rounded to nearest 5 seconds
            inboundLegInfo.transform.position =  (3f * newVector) + ((startPosition + endPosition) / 2f);


            var outboundLegInfoHeading = outboundLegInfo.transform.GetChild(0).gameObject;
            outboundLegInfoHeading.GetComponent<TextMesh>().text = inverseBearing.ToString("D3");
            var outboundLegInfoDuration = outboundLegInfo.transform.GetChild(1).gameObject;
            outboundLegInfoDuration.GetComponent<TextMesh>().text = durationMinutes;
            outboundLegInfo.transform.position = (-3f * newVector) + ((startPosition + endPosition) / 2f);


            var outboundLegInfoBackground = outboundLegInfo.transform.GetChild(2).gameObject;
            outboundLegInfoBackground.GetComponent<MeshRenderer>().material.color = new Color(1,0,0,0.33f);

            var inboundLegInfoBackground = inboundLegInfo.transform.GetChild(2).gameObject;
            inboundLegInfoBackground.GetComponent<MeshRenderer>().material.color = new Color(0, 0, 1, 0.33f);

            int legTimeMinutes = TimeSpan.FromHours((legDistanceNm /  flightSpeed)).Minutes;
            
            //TODO: this is sort of constant by the flightSpeed...
            float minuteLength = (float)legDistanceNm / ((float)(legDistanceNm /  flightSpeed)*60f);
            
            //print("BEFORE: minutes.Count: " +  minutes.Count + " leg minutes: " + roundedMinutes);
            
            // clean up redundant minute markers (when the leg shortens...)
            int ii=minutes.Count;
            while (minutes.Count > 0 &&  minutes.Count > legTimeMinutes && ((ii - 1) < minutes.Count))
            {
                Destroy(minutes[ii-1].Inbound.Marker);
                Destroy(minutes[ii-1].Outbound.Marker);
                minutes.RemoveAt(ii-1);
                ii++;
            }
            

            if (legTimeMinutes > 0)
            {
                //Add missing minute markers
                for (int i = minutes.Count; i <= legTimeMinutes-1; i+=1)
                {

                    MinutePair pair = new MinutePair();
                    
                    MinuteMarker inbound = new MinuteMarker();
                    MinuteMarker outbound = new MinuteMarker();
                    
                    inbound.Marker = Instantiate(emptyLine, new Vector3(0,-0.1f,0), Quaternion.identity);
                    inbound.Marker.transform.SetParent(gameObject.transform);
                    inbound.Marker.GetComponent<Renderer>().material.color = Color.blue;
                    
                    outbound.Marker = Instantiate(emptyLine, new Vector3(0,-0.1f,0), Quaternion.identity);
                    outbound.Marker.transform.SetParent(gameObject.transform);
                    outbound.Marker.GetComponent<Renderer>().material.color = Color.red;
                    
                    // TODO: Need to do this only for even minutes!

                    if (!IsEven(i))
                    {
                        inbound.Text = Instantiate(minuteText, Vector3.zero, Quaternion.identity);
                        inbound.Text.transform.SetParent(inbound.Marker.transform);
                        inbound.Text.GetComponent<Renderer>().material.color = Color.blue;

                        outbound.Text = Instantiate(minuteText, Vector3.zero, Quaternion.identity);
                        outbound.Text.transform.SetParent(inbound.Marker.transform);
                        outbound.Text.GetComponent<Renderer>().material.color = Color.red;
                        //flip the label for the outbound markers
                        outbound.Text.GetComponent<RotationConstraint>().rotationOffset = new Vector3(90f, 0, 0);
                    }

                    pair.Inbound = inbound;  
                    pair.Outbound = outbound;  
                    
                    minutes.Add(pair);
                    //print("added minute: " + i);
                }
                
                // Update the current markers
                for (int i = 0; i <= legTimeMinutes-1; i+=1)
                {
                    var inboundMarkerLineRenderer = minutes[i].Inbound.Marker.GetComponent<LineRenderer>();
                    var outboundMarkerLineRenderer = minutes[i].Outbound.Marker.GetComponent<LineRenderer>();

                    
                    // gets the minute marker position along the leg
                    var inboundMarkerPosition = (minuteLength * (i+1)) * Vector3.Normalize(endPosition - startPosition) +
                                         startPosition;
                    
                    var outboundMarkerPosition = (minuteLength * (i+1)) * Vector3.Normalize(startPosition - endPosition) +
                                                endPosition;
                    
                    // get perpendicular vector of this leg
                    //var newVec = startPosition - endPosition;
                    //var newVector = Vector3.Cross(newVec, Vector3.up);
                    //newVector.Normalize();

                    // for even minutes let's make them longer, and with a text
                    float markerLength = 0.5f;
                    if (IsEven(i + 1))
                    {
                        markerLength = 1;
                        var inboundText = minutes[i].Inbound.Text;
                        inboundText.transform.position = inboundMarkerPosition + ((markerLength+0.5f) * newVector);
                        inboundText.SetActive(true);
                        inboundText.GetComponent<TextMesh>().text = (i + 1).ToString();
                        
                        var outboundText = minutes[i].Outbound.Text;
                        outboundText.transform.position = outboundMarkerPosition + ((-markerLength-0.5f) * newVector);
                        outboundText.SetActive(true);
                        outboundText.GetComponent<TextMesh>().text = (i + 1).ToString();
                    }

                    // draw the two points of the minute marker
                    inboundMarkerLineRenderer.SetPosition(0, inboundMarkerPosition + (markerLength * newVector));
                    inboundMarkerLineRenderer.SetPosition(1, inboundMarkerPosition);
                    
                    outboundMarkerLineRenderer.SetPosition(0, outboundMarkerPosition + (-markerLength * newVector));
                    outboundMarkerLineRenderer.SetPosition(1, outboundMarkerPosition);
                    
                }
            }


            // drift lines
            
            
            var rot10deg = Quaternion.Euler(0, 10f, 0);

            var rot10degPivot = rot10deg * (endPosition - startPosition);
            var rotatedEndPosition = rot10degPivot + startPosition;
            Vector3 angledVector = (startPosition + rotatedEndPosition) / 2;
            inboundDrift.SetPosition(0, startPosition);
            inboundDrift.SetPosition(1, angledVector);

            var rotNeg10degPivot = rot10deg * (startPosition - endPosition);
            var rotatedStartPosition = rotNeg10degPivot + endPosition;
            Vector3 angledNegVector = (endPosition + rotatedStartPosition) / 2;
            outboundDrift.SetPosition(0, endPosition);
            outboundDrift.SetPosition(1, angledNegVector);

            inboundDriftGO.GetComponent<Renderer>().material.mainTextureScale = new Vector2((float)legDistanceNm, 1);
            outboundDriftGO.GetComponent<Renderer>().material.mainTextureScale = new Vector2((float)legDistanceNm, 1);
        }

    }
}
