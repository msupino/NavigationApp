using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using CoordinateSharp;

//[ExecuteInEditMode]
public class LineDraw : MonoBehaviour
{
    
    public Transform start;
    public Transform end;
    public GameObject perpendicular;
    public TextMesh distanceText;
    public TextMesh durationText;
    public TextMesh headingText;

    //public Coordinate startCoord;
    //public Coordinate endCoord;

    private LineRenderer lineRenderer;
    private GameObject middle;
    
    // Start is called before the first frame update
    private void Start()
    {
        middle = Instantiate(perpendicular, Vector3.zero, Quaternion.identity);
        middle.transform.SetParent(gameObject.transform);
    }

    // Update is called once per frame
    void Update()
    {
        lineRenderer = GetComponent<LineRenderer>();
        var startPosition = start.position;
        lineRenderer.SetPosition(0, startPosition);
        var endPosition = end.position;
        lineRenderer.SetPosition(1, endPosition);


        // draw the mid line perpendicular to the main line
        var middleLine = middle.GetComponent<LineRenderer>();

        var newVec = startPosition - endPosition;
        var newVector = Vector3.Cross(newVec, Vector3.up);
        newVector.Normalize();

        var newPoint = 1 * newVector + ((startPosition + endPosition) / 2);
        var newPoint2 = -1 * newVector + ((startPosition + endPosition) / 2);

        middleLine.SetPosition(0, newPoint);
        middleLine.SetPosition(1, newPoint2);

        middle.SetActive(true);

    }
}
