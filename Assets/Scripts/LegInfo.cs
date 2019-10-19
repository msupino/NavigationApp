using System.Collections;
using System.Collections.Generic;
using UnityEngine;

public class LegInfo : MonoBehaviour
{

    private void OnMouseOver()
    {
        gameObject.GetComponent<LineRenderer>().startWidth = 0.08f;
        gameObject.GetComponent<LineRenderer>().endWidth = 0.08f;
        gameObject.GetComponent<Renderer>().material.color = Color.yellow;
    }

    private void OnMouseExit()
    {
        gameObject.GetComponent<LineRenderer>().startWidth = 0.05f;
        gameObject.GetComponent<LineRenderer>().endWidth = 0.05f;
        gameObject.GetComponent<Renderer>().material.color = Color.black;
    }
}
