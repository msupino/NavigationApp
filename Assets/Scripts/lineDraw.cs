using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using CoordinateSharp;

//[ExecuteInEditMode]
public class lineDraw : MonoBehaviour
{
    
    public Transform start;
    public Transform end;
    public GameObject perpendicular;
    public TextMesh distanceText;
    public TextMesh durationText;
    public TextMesh headingText;

    public Coordinate startCoord;
    public Coordinate endCoord;

    private LineRenderer lineRenderer;
    private GameObject middle;
    
    // Start is called before the first frame update
    void Start()
    {
        middle = Instantiate(perpendicular, Vector3.zero, Quaternion.identity);
        middle.transform.SetParent(gameObject.transform);
    }

    // Update is called once per frame
    void Update()
    {
        lineRenderer = GetComponent<LineRenderer>();
        lineRenderer.SetPosition(0, start.position);
        lineRenderer.SetPosition(1, end.position);


        // draw the mid line perpendicular to the main line
        LineRenderer middleLine;
        middleLine = middle.GetComponent<LineRenderer>();

        var newVec = start.position - end.position;
        var newVector = Vector3.Cross(newVec, Vector3.up);
        newVector.Normalize();

        var newPoint = 1 * newVector + ((start.position + end.position) / 2);
        var newPoint2 = -1 * newVector + ((start.position + end.position) / 2);

        middleLine.SetPosition(0, newPoint);
        middleLine.SetPosition(1, newPoint2);

        middle.SetActive(true);

    }
}
